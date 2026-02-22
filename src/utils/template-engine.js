const ejs = require('ejs');
const fs = require('fs-extra');
const path = require('path');
const prettier = require('prettier');
const javaPlugin = require('prettier-plugin-java').default;

const PRETTIER_JAVA_OPTIONS = {
  parser: 'java',
  plugins: [javaPlugin],
  tabWidth: 4,
  printWidth: 120,
  trailingComma: 'none',
  endOfLine: 'lf',
};

/**
 * Render a template file with given context
 * @param {string} templatePath - Path to template file
 * @param {object} context - Template variables
 * @returns {Promise<string>} Rendered template
 */
async function renderTemplate(templatePath, context) {
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  return ejs.render(templateContent, context);
}

/**
 * Render and write template to destination
 * @param {string} templatePath - Path to template file
 * @param {string} destPath - Destination file path
 * @param {object} context - Template variables
 */
async function renderAndWrite(templatePath, destPath, context) {
  let content = await renderTemplate(templatePath, context);
  if (destPath.endsWith('.java')) {
    try {
      content = await prettier.format(content, PRETTIER_JAVA_OPTIONS);
    } catch (e) {
      // Fail-safe: write unformatted content if the formatter encounters a parse error
      console.warn(`[prettier] Could not format ${path.basename(destPath)}: ${e.message}`);
    }
  }
  await fs.ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, content, 'utf-8');
}

/**
 * Get template file paths recursively
 * @param {string} dir - Directory to scan
 * @param {Array<string>} fileList - Accumulated file list
 * @returns {Promise<Array<string>>} List of template file paths
 */
async function getTemplateFiles(dir, fileList = []) {
  const files = await fs.readdir(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    
    if (stat.isDirectory()) {
      await getTemplateFiles(filePath, fileList);
    } else if (file.endsWith('.ejs')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

module.exports = {
  renderTemplate,
  renderAndWrite,
  getTemplateFiles
};
