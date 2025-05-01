import type { CloudFormationTemplate } from './cloudformation';
/**
 * Computes the digest for each resource in the template.
 *
 * Conceptually, the digest is computed as:
 *
 *     d(resource) = hash(type + physicalId)                       , if physicalId is defined
 *                 = hash(type + properties + dependencies.map(d)) , otherwise
 *
 * where `hash` is a cryptographic hash function. In other words, if a resource has
 * a physical ID, we use the physical ID plus its type to uniquely identify
 * that resource. In this case, the digest can be computed from these two fields
 * alone. A corollary is that such resources can be renamed and have their
 * properties updated at the same time, and still be considered equivalent.
 *
 * Otherwise, the digest is computed from its type, its own properties (that is,
 * excluding properties that refer to other resources), and the digests of each of
 * its dependencies.
 *
 * The digest of a resource, defined recursively this way, remains stable even if
 * one or more of its dependencies gets renamed. Since the resources in a
 * CloudFormation template form a directed acyclic graph, this function is
 * well-defined.
 */
export declare function computeResourceDigests(template: CloudFormationTemplate): Record<string, string>;
export declare function hashObject(obj: any): string;
