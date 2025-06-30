// Minimal changes needed to implement language auto-detection for custom templates

// 1. Remove TypeScript-only restriction
// Line 56-58: Remove this validation
if ((options.templatePath || options.gitUrl || options.npmPackage) && options.language && options.language !== 'typescript') {
  throw new ToolkitError('Custom templates are currently only supported for TypeScript');
}

// 2. For Git templates - replace lines 81-87:
// OLD:
// Validate that the template has a typescript directory
if (!await fs.pathExists(path.join(templatePath, 'typescript'))) {
  throw new ToolkitError('Git template must contain a \'typescript\' directory');
}
template = await InitTemplate.fromPath(templatePath, templateName);
// Force language to typescript for Git templates
language = 'typescript';

// NEW:
template = await InitTemplate.fromPath(templatePath, templateName);
// Auto-detect language if not specified
if (!language && template.languages.length === 1) {
  language = template.languages[0];
}

// 3. For NPM packages - replace lines 105-111:
// OLD:
// Validate that the template has a typescript directory
if (!await fs.pathExists(path.join(templatePath, 'typescript'))) {
  throw new ToolkitError('NPM package must contain a \'typescript\' directory');
}
template = await InitTemplate.fromPath(templatePath, templateName);
// Force language to typescript for NPM templates
language = 'typescript';

// NEW:
template = await InitTemplate.fromPath(templatePath, templateName);
// Auto-detect language if not specified
if (!language && template.languages.length === 1) {
  language = template.languages[0];
}

// 4. For local templates - replace lines 123-129:
// OLD:
// Validate that the template has a typescript directory
if (!await fs.pathExists(path.join(templatePath, 'typescript'))) {
  throw new ToolkitError('Custom template must contain a \'typescript\' directory');
}
template = await InitTemplate.fromPath(templatePath, templateName);
// Force language to typescript for custom templates
language = 'typescript';

// NEW:
template = await InitTemplate.fromPath(templatePath, templateName);
// Auto-detect language if not specified
if (!language && template.languages.length === 1) {
  language = template.languages[0];
}

// 5. Update help text - replace line 145:
// OLD: (typescript only for now)
// NEW: (auto-detects language from template)