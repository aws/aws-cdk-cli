import { TestCliNpmSource } from './cli-npm-source';
import { TestCliRepoSource } from './cli-repo-source';
import { TestLibraryNpmSource } from './library-npm-source';
import { TestLibraryPreinstalledSource } from './library-preinstalled-source';
import type { Constructor, IPreparedRunnerSource, ITestCliSource, ITestLibrarySource } from './source';

export interface PreparedSources {
  readonly cli: IPreparedRunnerSource<ITestCliSource>;
  readonly library: IPreparedRunnerSource<ITestLibrarySource>;
  readonly toolkitLib: IPreparedRunnerSource<ITestLibrarySource>;
}

type SourceType<A> = A extends IPreparedRunnerSource<infer T> ? T : unknown;

export function serializeSources(sources: PreparedSources) {
  const ret: Record<string, SerializedDescriptor> = {};
  for (const [k, v] of Object.entries(sources)) {
    const descriptor =(v as IPreparedRunnerSource<any>).serialize();
    ret[k] = [descriptor[0].name, descriptor[1]];
  }
  process.env.SOURCES = JSON.stringify(ret);
}

export function testSource<K extends keyof PreparedSources>(k: K): SourceType<PreparedSources[K]> {
  if (!process.env.SOURCES) {
    throw new Error('$SOURCES not set');
  }
  const sources = JSON.parse(process.env.SOURCES) as Record<string, SerializedDescriptor>;
  return instantiateDescriptor(sources[k]);
}

const CONSTRUCTORS: Constructor<any>[] = [
  TestCliRepoSource,
  TestCliNpmSource,
  TestLibraryNpmSource,
  TestLibraryPreinstalledSource,
];

function instantiateDescriptor([constructorName, args]: SerializedDescriptor): any {
  for (const ctr of CONSTRUCTORS) {
    if (ctr.name === constructorName) {
      return new ctr(...args);
    }
  }
  throw new Error(`Unrecognized constructor: ${constructorName}`);
}

type SerializedDescriptor = [string, args: any[]];
