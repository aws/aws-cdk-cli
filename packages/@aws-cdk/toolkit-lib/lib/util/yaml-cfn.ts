import * as yaml from 'yaml';

/**
 * Serializes the given data structure into valid YAML.
 *
 * @param obj - the data structure to serialize
 * @returns a string containing the YAML representation of {@param obj}
 */
export function serialize(obj: any): string {
  return yaml.stringify(obj, {
    schema: 'yaml-1.1',
    lineWidth: 0,
  });
}

/**
 * Deserialize the YAML into the appropriate data structure.
 *
 * @param str - the string containing YAML
 * @returns the data structure the YAML represents
 *   (most often in case of CloudFormation, an object)
 */
export function deserialize(str: string): any {
  return parseYamlStrWithCfnTags(str);
}

/**
 * Creates the tags for a CloudFormation short-form intrinsic (e.g. `!Sub`).
 *
 * In yaml v2 a tag only applies to one node type, so we need three tags per
 * intrinsic: one each for scalars (`!Ref X`), sequences (`!Join [...]`)
 * and maps (`!Transform {...}`).
 *
 * The tag value has already been parsed by the time `resolve` is called
 * (including any nested short-form tags), so we only need to wrap it in
 * the long-form `{ "Fn::Xyz": value }` object.
 */
function makeTagsForCfnIntrinsic(intrinsicName: string, addFnPrefix: boolean): yaml.Tags {
  const tag = `!${intrinsicName}`;
  const key = addFnPrefix ? `Fn::${intrinsicName}` : intrinsicName;

  // For collections, keep the parsed node as the map value so it is converted
  // to JS (incl. nested tags and aliases) together with the rest of the document
  const wrap = (value: yaml.Node) => {
    const map = new yaml.YAMLMap();
    map.items.push(new yaml.Pair(new yaml.Scalar(key), value));
    return map;
  };

  return [
    {
      tag,
      // Scalar tags must return a plain value; yaml wraps it in a Scalar node itself
      resolve: (value: string) => ({ [key]: value }),
    } satisfies yaml.ScalarTag,
    {
      tag,
      collection: 'seq',
      resolve: (value) => wrap(value as yaml.YAMLSeq),
    } satisfies yaml.CollectionTag,
    {
      tag,
      collection: 'map',
      resolve: (value) => wrap(value as yaml.YAMLMap),
    } satisfies yaml.CollectionTag,
  ];
}

const shortForms: yaml.Tags = [
  'Base64', 'Cidr', 'FindInMap', 'GetAZs', 'ImportValue', 'Join', 'Sub',
  'Select', 'Split', 'Transform', 'And', 'Equals', 'If', 'Not', 'Or', 'GetAtt',
].flatMap(name => makeTagsForCfnIntrinsic(name, true)).concat(
  makeTagsForCfnIntrinsic('Ref', false),
  makeTagsForCfnIntrinsic('Condition', false),
);

function parseYamlStrWithCfnTags(text: string): any {
  return yaml.parse(text, {
    customTags: shortForms,
    schema: 'core',
    // revert a new v2 default
    maxAliasCount: -1,
    // CloudFormation accepts duplicate keys in both JSON and YAML templates and uses the last value.
    // Verified by deploying templates with duplicate keys to CFN. So we do the same.
    uniqueKeys: false,
  });
}
