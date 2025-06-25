var path = require('path');
var fs = require('fs');
var contents = fs.readFileSync(`${__dirname}/.eslintrc.json`, { encoding: 'utf-8' });
// Strip comments, JSON.parse() doesn't like those
contents = contents.replace(/^\/\/.*$/m, '');
var json = JSON.parse(contents);
// Patch the .json config with something that can only be represented in JS
json.parserOptions.tsconfigRootDir = __dirname;
module.exports = json;