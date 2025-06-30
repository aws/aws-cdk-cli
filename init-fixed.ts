// Fixed version of the NPM template section with language auto-detection

        template = await InitTemplate.fromPath(templatePath, templateName);

        // Auto-detect language if not specified
        if (!language && template.languages.length === 1) {
          language = template.languages[0];
        }