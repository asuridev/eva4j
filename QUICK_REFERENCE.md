# Quick Reference: Configuration Persistence Feature

## New Command

```bash
eva4j info
```

**Purpose**: Display project configuration and module history

**Output Example**:
```
📦 Eva4j Project Information

Project Details:
  Name:              my-shop
  Group ID:          com.company
  Artifact ID:       my-shop
  Package:           com.company.myshop

Versions:
  Java:              21
  Spring Boot:       3.5.5
  Spring Modulith:   1.4.6

Dependencies:
  • web
  • data-jpa
  • validation

Modules:
  • user (soft-delete, audit)
  • product (soft-delete, audit)

Timestamps:
  Created:           1/27/2026, 10:25:00 AM
  Last Updated:      1/27/2026, 10:35:00 AM
```

## .eva4j.json File

**Location**: Project root directory

**Purpose**: 
- Persist project configuration
- Track module history
- Share state with team members

**When Created**: Automatically when you run `eva4j create <project-name>`

**When Updated**: Automatically when you run `eva4j add module <module-name>`

**Should I commit it?**: **YES!** 
- It's tracked in git by default
- Helps team members see project state
- Ensures consistent configuration

## What Gets Persisted?

### Project Information
- Project name, group ID, artifact ID
- Base package name
- Java version
- Spring Boot version
- Spring Modulith version

### Dependencies
- Selected dependencies (web, data-jpa, security, etc.)

### Modules
- Module names
- Module options:
  - hasSoftDelete: boolean
  - hasAudit: boolean
- Creation timestamps per module

### Timestamps
- Project creation date/time
- Last update date/time

## Usage Examples

### View Project Configuration
```bash
cd my-shop
eva4j info
```

### Check Before Adding Module
```bash
eva4j info  # See existing modules
eva4j add module inventory  # Add new module
eva4j info  # Verify module was added
```

### After Closing Terminal
```bash
# Day 1
eva4j create my-shop
cd my-shop
eva4j add module user

# Close terminal...

# Day 2 - Open new terminal
cd my-shop
eva4j info  # Shows all previous configuration!
eva4j add module product  # Continues where you left off
```

## New Validations

### Module Duplicate Prevention
```bash
eva4j add module user
# Success! Module created

eva4j add module user
# ❌ Module 'user' is already registered
```

The CLI now checks both:
1. Filesystem (does directory exist?)
2. Configuration file (is module registered?)

## Error Messages

### Not in Project Directory
```bash
cd /some/other/folder
eva4j info
# ❌ Not in an eva4j project directory
# Run this command inside a project created with eva4j
```

### Configuration File Issues
```bash
eva4j add module test
# (if .eva4j.json is corrupted)
# ❌ Could not load project configuration
```

## Developer Notes

### ConfigManager API

```javascript
const ConfigManager = require('./src/utils/config-manager');

// Create instance
const configManager = new ConfigManager(projectPath);

// Check if config exists
const exists = await configManager.exists();

// Load configuration
const config = await configManager.loadProjectConfig();

// Save project configuration
await configManager.saveProjectConfig({
  projectName: 'my-shop',
  groupId: 'com.company',
  // ... more fields
});

// Add module
await configManager.addModule('user', {
  hasSoftDelete: true,
  hasAudit: true
});

// Check if module exists
const exists = await configManager.moduleExists('user');

// Get all modules
const modules = await configManager.getModules();
```

## Tips

1. **Always run `eva4j info`** before adding modules to see current state
2. **Commit .eva4j.json** to share configuration with your team
3. **Don't manually edit .eva4j.json** - let the CLI manage it
4. **Use info command** for troubleshooting configuration issues
5. **Configuration persists across sessions** - no need to remember what you did

## Compatibility

- Works with all existing eva4j projects
- Backward compatible (won't break existing projects without .eva4j.json)
- Forward compatible (configuration format can be extended)

## Files Involved

- **src/utils/config-manager.js** - Configuration management
- **src/commands/info.js** - Info display command
- **src/generators/base-generator.js** - Saves config on project creation
- **src/commands/add-module.js** - Updates config on module addition
- **bin/eva4j.js** - Registers info command
- **templates/base/root/gitignore.ejs** - Ensures .eva4j.json is tracked

---

**For full documentation, see**: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
