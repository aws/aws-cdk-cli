# Language Auto-Detection Implementation

The changes should be made directly in `init.ts` - no separate file needed.

## Minimal Changes Required:

1. **Remove line 56-58**: Delete the TypeScript-only restriction
2. **Replace Git template logic (lines ~81-87)**: Remove typescript validation, add auto-detection
3. **Replace NPM template logic (lines ~105-111)**: Remove typescript validation, add auto-detection  
4. **Replace local template logic (lines ~123-129)**: Remove typescript validation, add auto-detection

## Pattern for all three template types:
```typescript
// OLD:
// Validate that the template has a typescript directory
if (!await fs.pathExists(path.join(templatePath, 'typescript'))) {
  throw new ToolkitError('Template must contain a \'typescript\' directory');
}
template = await InitTemplate.fromPath(templatePath, templateName);
// Force language to typescript
language = 'typescript';

// NEW:
template = await InitTemplate.fromPath(templatePath, templateName);
// Auto-detect language if not specified
if (!language && template.languages.length === 1) {
  language = template.languages[0];
}
```

This leverages existing validation in `InitTemplate.fromPath()` and `template.install()` methods.