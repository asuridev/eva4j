/** @type {import('prettier').Config} */
module.exports = {
  plugins: ['prettier-plugin-java'],
  // Java-specific settings
  tabWidth: 4,
  printWidth: 120,
  trailingComma: 'none',
  endOfLine: 'lf',
};
