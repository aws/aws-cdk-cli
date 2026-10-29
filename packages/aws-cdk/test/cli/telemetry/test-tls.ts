import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A throwaway certificate authority plus a leaf certificate for `localhost`.
 */
export interface TestCa {
  /**
   * PEM contents of the CA certificate, to be passed to the code under test as a trusted root.
   */
  readonly caCert: string;

  /**
   * Path to the CA certificate on disk.
   *
   * The sender is configured with a bundle PATH rather than its contents, so this is what most
   * tests actually need. Removed by `cleanupTestCas()`.
   */
  readonly caCertPath: string;

  /**
   * PEM contents of the leaf certificate, for the test server.
   */
  readonly serverCert: string;

  /**
   * PEM contents of the leaf private key, for the test server.
   */
  readonly serverKey: string;
}

/**
 * Options for `generateTestCa`.
 */
export interface TestCaOptions {
  /**
   * OpenSSL `subjectAltName` value for the leaf certificate.
   *
   * Override this to mint a certificate that deliberately does NOT cover the host under test, which
   * is how the identity-verification tests prove a mismatch is rejected. Note that modern TLS
   * ignores the subject CN entirely, so the SAN is the only thing that matters.
   *
   * @default 'DNS:localhost,IP:127.0.0.1'
   */
  readonly subjectAltName?: string;

  /**
   * Subject common name for the leaf certificate.
   *
   * @default 'localhost'
   */
  readonly commonName?: string;
}

/**
 * Directories created by `generateTestCa`, so they can all be removed at the end of a suite.
 */
const generatedDirs: string[] = [];

/**
 * Remove every directory created by `generateTestCa`. Call from `afterAll`.
 */
export function cleanupTestCas(): void {
  while (generatedDirs.length > 0) {
    fs.rmSync(generatedDirs.pop()!, { recursive: true, force: true });
  }
}

/**
 * Mint a fresh CA and leaf certificate for use by a test HTTPS server.
 *
 * Generated at runtime rather than committed as a fixture: this repository ships no key material,
 * and a checked-in private key would be both a bad precedent and something that expires. This is
 * the same approach the integration tests take (`mockttp.generateCACertificate`), minus the
 * dependency.
 *
 * The generated files stay on disk -- the code under test is given a bundle path, not its contents --
 * until `cleanupTestCas()` removes them.
 *
 * Requires `openssl` on PATH, which is present on every platform this package is tested on.
 */
export function generateTestCa(options: TestCaOptions = {}): TestCa {
  const subjectAltName = options.subjectAltName ?? 'DNS:localhost,IP:127.0.0.1';
  const commonName = options.commonName ?? 'localhost';

  // The jest setup chdir's into a deliberately read-only directory, so be explicit about where we
  // write.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-telemetry-tls-'));
  generatedDirs.push(dir);

  const file = (name: string) => path.join(dir, name);
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });

  openssl('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '3650', '-nodes',
    '-keyout', file('ca.key'), '-out', file('ca.crt'),
    '-subj', '/CN=CDK Telemetry Test Root CA',
    '-addext', 'basicConstraints=critical,CA:TRUE');

  openssl('req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', file('server.key'), '-out', file('server.csr'),
    '-subj', `/CN=${commonName}`);

  fs.writeFileSync(file('server.ext'), [
    `subjectAltName=${subjectAltName}`,
    'basicConstraints=CA:FALSE',
    'extendedKeyUsage=serverAuth',
    '',
  ].join('\n'));

  openssl('x509', '-req', '-in', file('server.csr'),
    '-CA', file('ca.crt'), '-CAkey', file('ca.key'), '-CAcreateserial',
    '-out', file('server.crt'), '-days', '3650', '-sha256',
    '-extfile', file('server.ext'));

  return {
    caCert: fs.readFileSync(file('ca.crt'), 'utf-8'),
    caCertPath: file('ca.crt'),
    serverCert: fs.readFileSync(file('server.crt'), 'utf-8'),
    serverKey: fs.readFileSync(file('server.key'), 'utf-8'),
  };
}
