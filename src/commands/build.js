'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');

const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toCamelCase, toPackagePath } = require('../utils/naming');
const SharedGenerator = require('../generators/shared-generator');
const { renderAndWrite } = require('../utils/template-engine');
const addModuleCommand = require('./add-module');
const addKafkaClientCommand = require('./add-kafka-client');
const generateEntitiesCommand = require('./generate-entities');

// ── H2 mock config ─────────────────────────────────────────────────────────────
const H2_DB_YAML = (packageName) => `spring:
  datasource:
    url: jdbc:h2:mem:mockdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
    username: sa
    password: ''
    driver-class-name: org.h2.Driver
  h2:
    console:
      enabled: true
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: true
    properties:
      hibernate:
        format_sql: true
        dialect: org.hibernate.dialect.H2Dialect

logging:
  level:
    root: INFO
    ${packageName}: DEBUG
`;

const H2_GRADLE_LINE = `    runtimeOnly 'com.h2database:h2'`;
const ENVS = ['local', 'develop', 'test', 'production'];

/**
 * Rebuild db context from projectConfig fields (mirrors detach.js logic).
 */
function buildDbContext(projectConfig) {
  const databaseType = projectConfig.databaseType || 'postgresql';
  const databaseName = (projectConfig.artifactId || projectConfig.projectName || 'app').replace(/-/g, '_');

  const dbMap = {
    h2: {
      driver: 'com.h2.database:h2',
      driverClass: 'org.h2.Driver',
      url: `jdbc:h2:mem:${databaseName}`,
      username: 'sa',
      password: '',
      hibernateDialect: 'org.hibernate.dialect.H2Dialect',
    },
    postgresql: {
      driver: 'org.postgresql:postgresql',
      driverClass: 'org.postgresql.Driver',
      url: `jdbc:postgresql://localhost:5432/${databaseName}`,
      username: 'postgres',
      password: 'postgres',
      hibernateDialect: 'org.hibernate.dialect.PostgreSQLDialect',
    },
    mysql: {
      driver: 'com.mysql:mysql-connector-j',
      driverClass: 'com.mysql.cj.jdbc.Driver',
      url: `jdbc:mysql://localhost:3306/${databaseName}`,
      username: 'root',
      password: 'root',
      hibernateDialect: 'org.hibernate.dialect.MySQLDialect',
    },
  };

  const db = dbMap[databaseType] || dbMap.postgresql;
  return {
    dependencies: projectConfig.dependencies || ['data-jpa'],
    packageName: projectConfig.packageName,
    databaseType,
    databaseName,
    databaseDriverClass: db.driverClass,
    databaseUrl: db.url,
    databaseUsername: db.username,
    databasePassword: db.password,
    hibernateDialect: db.hibernateDialect,
  };
}

/**
 * Regenerate db.yaml files from EJS templates using project's original DB config.
 * Guarantees correctness even if backup contained stale/wrong content.
 */
async function regenerateDbYaml(projectDir, projectConfig) {
  const dbContext = buildDbContext(projectConfig);
  const templatesDir = path.join(__dirname, '../../templates/base');
  const resourcesPath = path.join(projectDir, 'src', 'main', 'resources');

  for (const env of ENVS) {
    const templatePath = path.join(templatesDir, 'resources', 'parameters', env, 'db.yaml.ejs');
    const destPath = path.join(resourcesPath, 'parameters', env, 'db.yaml');
    if (await fs.pathExists(templatePath)) {
      await renderAndWrite(templatePath, destPath, dbContext);
    }
  }
}

/**
 * Rebuild the runtimeOnly DB driver line in build.gradle from project's original DB type.
 */
async function regenerateBuildGradleDbDriver(projectDir, projectConfig) {
  const databaseType = projectConfig.databaseType || 'postgresql';
  const driverMap = {
    h2: `    runtimeOnly 'com.h2.database:h2'`,
    postgresql: `    runtimeOnly 'org.postgresql:postgresql'`,
    mysql: `    runtimeOnly 'com.mysql:mysql-connector-j'`,
  };
  const correctLine = driverMap[databaseType] || driverMap.postgresql;

  const buildGradlePath = path.join(projectDir, 'build.gradle');
  if (await fs.pathExists(buildGradlePath)) {
    const current = await fs.readFile(buildGradlePath, 'utf-8');
    const fixed = current.replace(
      /^[ \t]*runtimeOnly\s+['"][^'"]+['"]\s*(?:\/\/.*)?$/m,
      correctLine
    );
    await fs.writeFile(buildGradlePath, fixed, 'utf-8');
  }
}

const H2_SECURITY_CONFIG = (packageName) => {
  const S = '$'; // prevent JS template interpolation of Spring EL ${...}
  return `package ${packageName}.shared.infrastructure.configurations.securityConfig;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

// ⚡ MOCK MODE — generated by eva build --mock
// Restored automatically on next eva build (without --mock)
@EnableWebSecurity
@EnableMethodSecurity
@Configuration
public class SecurityConfig {
  @Value("#{'${S}{cors.allowedOrigins}'.split(',')}")
  private List<String> allowedOrigins;

  @Value("#{'${S}{cors.allowedMethods}'.split(',')}")
  private List<String> allowedMethods;

  @Value("#{'${S}{cors.allowedHeaders}'.split(',')}")
  private List<String> allowedHeaders;

  private List<String> removeWhiteSpace(List<String> list) {
    return list.stream().map(String::trim).toList();
  }

  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/h2-console/**").permitAll()
            .anyRequest().permitAll()
        )
        .headers(headers -> headers
            .frameOptions(frame -> frame.sameOrigin())
        );
    return http.build();
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration configuration = new CorsConfiguration();
    configuration.setAllowedOrigins(removeWhiteSpace(allowedOrigins));
    configuration.setAllowedMethods(removeWhiteSpace(allowedMethods));
    configuration.setAllowedHeaders(removeWhiteSpace(allowedHeaders));
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", configuration);
    return source;
  }
}
`;
};

/**
 * Backup original DB files and replace them with H2 config.
 * Persists backups to .eva4j.json BEFORE writing any file so a
 * crash mid-swap is recoverable on next run.
 */
async function swapToH2(projectDir, packageName, configManager) {
  const backups = {};

  // ── db.yaml per environment ──────────────────────────────────────────────
  for (const env of ENVS) {
    const dbYamlPath = path.join(
      projectDir, 'src', 'main', 'resources', 'parameters', env, 'db.yaml'
    );
    if (await fs.pathExists(dbYamlPath)) {
      backups[`db_${env}`] = { path: dbYamlPath, content: await fs.readFile(dbYamlPath, 'utf-8') };
    }
  }

  // ── build.gradle ─────────────────────────────────────────────────────────
  const buildGradlePath = path.join(projectDir, 'build.gradle');
  if (await fs.pathExists(buildGradlePath)) {
    backups.buildGradle = { path: buildGradlePath, content: await fs.readFile(buildGradlePath, 'utf-8') };
  }

  // ── SecurityConfig.java ───────────────────────────────────────────────────
  const packagePath = toPackagePath(packageName);
  const securityConfigPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    'shared', 'infrastructure', 'configurations', 'securityConfig', 'SecurityConfig.java'
  );
  if (await fs.pathExists(securityConfigPath)) {
    backups.securityConfig = { path: securityConfigPath, content: await fs.readFile(securityConfigPath, 'utf-8') };
  } else {
    backups.securityConfig = { path: securityConfigPath, content: null };
  }

  // ── KafkaConfig.java — backup so it can be restored later ────────────────
  const kafkaConfigPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    'shared', 'infrastructure', 'configurations', 'kafkaConfig', 'KafkaConfig.java'
  );
  if (await fs.pathExists(kafkaConfigPath)) {
    backups.kafkaConfig = { path: kafkaConfigPath, content: await fs.readFile(kafkaConfigPath, 'utf-8') };
  } else {
    backups.kafkaConfig = null; // no Kafka installed — nothing to do
  }

  // Persist backups BEFORE writing any file so a crash mid-swap is recoverable
  await configManager.saveMockBackup(backups);

  // ── Write H2 versions ────────────────────────────────────────────────────
  for (const env of ENVS) {
    if (backups[`db_${env}`]) {
      await fs.writeFile(backups[`db_${env}`].path, H2_DB_YAML(packageName), 'utf-8');
    }
  }

  if (backups.buildGradle) {
    let swapped = backups.buildGradle.content.replace(
      /^[ \t]*runtimeOnly\s+['"][^'"]+['"]\s*(?:\/\/.*)?$/m,
      H2_GRADLE_LINE
    );
    // Remove spring-kafka dependencies block when Kafka is installed
    swapped = swapped.replace(
      /\n?[ \t]*\/\/ Kafka\n[ \t]*implementation 'org\.springframework\.kafka:spring-kafka'\n[ \t]*testImplementation 'org\.springframework\.kafka:spring-kafka-test'\n\n?[ \t]*/,
      '\n\t'
    );
    await fs.writeFile(buildGradlePath, swapped, 'utf-8');
  }

  await fs.ensureDir(path.dirname(securityConfigPath));
  await fs.writeFile(securityConfigPath, H2_SECURITY_CONFIG(packageName), 'utf-8');

  // ── Remove KafkaConfig.java (restored from backup on eva build) ──────────
  if (backups.kafkaConfig) {
    await fs.remove(kafkaConfigPath);
  }

  return backups;
}

/**
 * Restore all files from backup stored in .eva4j.json and clear the entry.
 */
async function restoreFromH2(configManager) {
  const backups = await configManager.popMockBackup();
  if (!backups) return 0;

  for (const { path: filePath, content } of Object.values(backups)) {
    if (content === null) {
      // File was created by mock — delete it on restore
      await fs.remove(filePath);
    } else {
      await fs.writeFile(filePath, content, 'utf-8');
    }
  }
  return Object.keys(backups).length;
}

// ── Main build command ──────────────────────────────────────────────────────────
async function buildCommand(options = {}) {
  const projectDir = process.cwd();

  // ── 1. Validate project ─────────────────────────────────────────────────────
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // ── 2. Load project config ──────────────────────────────────────────────────
  const configManager = new ConfigManager(projectDir);
  const projectConfig = await configManager.loadProjectConfig();

  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  // ── 2b. Restore mock config if a previous --mock run left files swapped ──────
  if (!options.mock && await configManager.hasMockBackup()) {
    console.log(chalk.yellow('⚠️  Detected active mock (H2) config from a previous --mock run.'));
    console.log(chalk.yellow('   Restoring original database configuration before continuing...\n'));

    // Clear the backup flag (we no longer rely on stored content — we regenerate from source)
    await restoreFromH2(configManager);

    // Force-regenerate db.yaml files from templates using project's original DB config
    await regenerateDbYaml(projectDir, projectConfig);

    // Force-regenerate build.gradle DB driver line
    await regenerateBuildGradleDbDriver(projectDir, projectConfig);

    // Force-regenerate SecurityConfig from the original template
    const { packageName: pkgNameRestore } = projectConfig;
    const pkgPathRestore = toPackagePath(pkgNameRestore);
    const sharedBaseRestore = path.join(projectDir, 'src', 'main', 'java', pkgPathRestore, 'shared');
    if (await fs.pathExists(sharedBaseRestore)) {
      const sg = new SharedGenerator({
        packageName: pkgNameRestore,
        packagePath: pkgPathRestore,
        projectName: projectConfig.projectName || projectConfig.artifactId,
        groupId: projectConfig.groupId,
      });
      await sg.generateConfigurations(sharedBaseRestore);
    }

    console.log(chalk.green('   ✅ Database configuration restored to original.\n'));
  }

  // ── MOCK swap — swap DB + broker config, then run entity generation ────────
  if (options.mock) {
    if (await configManager.hasMockBackup()) {
      console.log(chalk.yellow('\n⚡ Mock (H2) is already active. Run eva build without --mock to restore.\n'));
      process.exit(0);
    }

    const { packageName: pkgName } = projectConfig;
    console.log(chalk.blue('\n🔀 eva build --mock\n'));
    console.log(chalk.gray(`  Project : ${projectConfig.projectName || projectConfig.artifactId}`));
    console.log(chalk.yellow('  Mode    : switching to H2 in-memory database + Spring Event bus\n'));
    console.log(chalk.blue('━━━ Swapping database & broker config ━━━━━━━━━━━━━━━━━━━━━━━━'));

    const backups = await swapToH2(projectDir, pkgName, configManager);
    const hasKafkaBackup = !!backups.kafkaConfig;
    console.log(chalk.green(`  ✅ ${Object.keys(backups).length} file(s) backed up and replaced`));
    if (hasKafkaBackup) {
      console.log(chalk.green('  ✅ KafkaConfig.java removed (Spring Events will be used instead)'));
      console.log(chalk.green('  ✅ spring-kafka dependencies removed from build.gradle'));
    }
    console.log(chalk.gray('     Backup saved to .eva4j.json — will be restored on next eva build\n'));

    // ── Regenerate broker layer if system.yaml exists and Kafka was installed ──
    const systemDir = path.join(projectDir, 'system');
    const systemYamlPath = path.join(systemDir, 'system.yaml');

    if (hasKafkaBackup && (await fs.pathExists(systemYamlPath))) {
      let systemConfig;
      try {
        const content = await fs.readFile(systemYamlPath, 'utf-8');
        systemConfig = yaml.load(content);
      } catch (err) {
        console.error(chalk.red('❌ Failed to parse system/system.yaml:'), err.message);
        process.exit(1);
      }

      const { modules: mockModules = [] } = systemConfig;
      const pkgPath = toPackagePath(pkgName);

      if (mockModules.length > 0) {
        console.log(chalk.blue('━━━ Regenerating broker layer (mock) ━━━━━━━━━━━━━━━━━━━━━━━━'));

        // Step 3: Copy domain.yaml files
        for (const mod of mockModules) {
          const sourceYaml = path.join(systemDir, `${mod.name}.yaml`);
          const modulePackageName = toCamelCase(mod.name);
          const destYaml = path.join(projectDir, 'src', 'main', 'java', pkgPath, modulePackageName, 'domain.yaml');
          if (!(await fs.pathExists(sourceYaml))) {
            console.log(chalk.yellow(`  ⚠️  system/${mod.name}.yaml not found — skipping ${mod.name}`));
            continue;
          }
          const content = await fs.readFile(sourceYaml, 'utf-8');
          await fs.ensureDir(path.dirname(destYaml));
          await fs.writeFile(destYaml, content, 'utf-8');
          console.log(chalk.green(`  ✅ ${mod.name}/domain.yaml updated`));
        }

        // Step 4: Regenerate entities with mock broker
        for (const mod of mockModules) {
          const modulePackageName = toCamelCase(mod.name);
          const domainYamlPath = path.join(projectDir, 'src', 'main', 'java', pkgPath, modulePackageName, 'domain.yaml');
          if (!(await fs.pathExists(domainYamlPath))) {
            console.log(chalk.yellow(`  ⚠️  domain.yaml not found for '${mod.name}' — skipping`));
            continue;
          }
          console.log(chalk.cyan(`\n  Regenerating broker layer for: ${mod.name}`));
          await generateEntitiesCommand(mod.name, { force: true, brokerMode: 'mock' });
        }
      }
    } else if (hasKafkaBackup) {
      console.log(chalk.yellow('  ℹ️  No system/system.yaml found — broker files must be regenerated manually.'));
      console.log(chalk.yellow('     Run: eva g entities <module> (with --force if needed)'));
    }

    console.log();
    console.log(chalk.yellow('  ⚡ Mock mode active. Run ./gradlew bootRun to start.'));
    console.log(chalk.yellow('     Run eva build (without --mock) to restore the original config.\n'));
    return;
  }

  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // ── 3. Read system/system.yaml ──────────────────────────────────────────────
  const systemDir = path.join(projectDir, 'system');
  const systemYamlPath = path.join(systemDir, 'system.yaml');

  if (!(await fs.pathExists(systemYamlPath))) {
    console.error(chalk.red('❌ system/system.yaml not found'));
    console.error(chalk.gray('Create system/system.yaml first with module definitions'));
    process.exit(1);
  }

  let systemConfig;
  try {
    const content = await fs.readFile(systemYamlPath, 'utf-8');
    systemConfig = yaml.load(content);
  } catch (err) {
    console.error(chalk.red('❌ Failed to parse system/system.yaml:'), err.message);
    process.exit(1);
  }

  const { modules = [], messaging } = systemConfig;

  if (!modules.length) {
    console.log(chalk.yellow('⚠️  No modules defined in system/system.yaml'));
    process.exit(0);
  }

  console.log(chalk.blue('\n🏗️  eva build\n'));
  console.log(chalk.gray(`  Project : ${projectConfig.projectName || projectConfig.artifactId}`));
  console.log(chalk.gray(`  Modules : ${modules.map(m => m.name).join(', ')}`));
  console.log();

  // ── STEP 1: Create modules ───────────────────────────────────────────────
    console.log(chalk.blue('━━━ Step 1: Creating modules ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    for (const mod of modules) {
      const modulePackageName = toCamelCase(mod.name);

      if (await configManager.moduleExists(modulePackageName)) {
        console.log(chalk.gray(`  ⏭  ${mod.name} — already exists, skipping`));
        continue;
      }

      const moduleDir = path.join(projectDir, 'src', 'main', 'java', packagePath, modulePackageName);
      if (await fs.pathExists(moduleDir)) {
        console.log(chalk.gray(`  ⏭  ${mod.name} — directory already exists, skipping`));
        continue;
      }

      console.log(chalk.cyan(`  ➕ Adding module: ${mod.name}`));
      await addModuleCommand(mod.name, {});
      await configManager.loadProjectConfig();
    }

    console.log();

    // ── STEP 2: Install broker client ────────────────────────────────────────
    console.log(chalk.blue('━━━ Step 2: Installing broker client ━━━━━━━━━━━━━━━━━━━━━━━━━'));

    const brokerEnabled = messaging && messaging.enabled === true;
    const broker = messaging && messaging.broker;

    if (!brokerEnabled || !broker) {
      console.log(chalk.gray('  ⏭  No messaging configured, skipping broker install'));
    } else if (broker === 'kafka') {
      if (await configManager.featureExists('kafka')) {
        console.log(chalk.gray('  ⏭  kafka-client — already installed, skipping'));
      } else {
        console.log(chalk.cyan('  ➕ Installing kafka-client'));
        await addKafkaClientCommand();
      }
    } else {
      console.log(chalk.yellow(`  ⚠️  Broker '${broker}' is not supported by eva build (only kafka is supported)`));
    }

    console.log();

    // ── STEP 3: Copy domain.yaml files ──────────────────────────────────────
    console.log(chalk.blue('━━━ Step 3: Copying domain.yaml files ━━━━━━━━━━━━━━━━━━━━━━━'));

    for (const mod of modules) {
      const sourceYaml = path.join(systemDir, `${mod.name}.yaml`);
      const modulePackageName = toCamelCase(mod.name);
      const destYaml = path.join(
        projectDir, 'src', 'main', 'java', packagePath, modulePackageName, 'domain.yaml'
      );

      if (!(await fs.pathExists(sourceYaml))) {
        console.log(chalk.yellow(`  ⚠️  system/${mod.name}.yaml not found — skipping ${mod.name}`));
        continue;
      }

      const content = await fs.readFile(sourceYaml, 'utf-8');
      await fs.ensureDir(path.dirname(destYaml));
      await fs.writeFile(destYaml, content, 'utf-8');
      console.log(chalk.green(`  ✅ ${mod.name}/domain.yaml updated`));
    }

    console.log();

    // ── STEP 4: Generate entities ────────────────────────────────────────────
    console.log(chalk.blue('━━━ Step 4: Generating entities ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    const generateOptions = { force: options.force || false };

    for (const mod of modules) {
      const modulePackageName = toCamelCase(mod.name);
      const domainYamlPath = path.join(
        projectDir, 'src', 'main', 'java', packagePath, modulePackageName, 'domain.yaml'
      );

      if (!(await fs.pathExists(domainYamlPath))) {
        console.log(chalk.yellow(`  ⚠️  domain.yaml not found for '${mod.name}' — skipping entity generation`));
        continue;
      }

      console.log(chalk.cyan(`\n  Generating entities for: ${mod.name}`));
      await generateEntitiesCommand(mod.name, generateOptions);
    }

  console.log();
  console.log(chalk.green('✅ eva build completed successfully\n'));
}

module.exports = buildCommand;
