/**
 * Run code with additional environment variables
 */
export async function withEnv(block: () => Promise<any>, env: Record<string, string | undefined> = {}) {
  const originalEnv = process.env;
  try {
    process.env = {
      ...originalEnv,
      ...env,
    };

    return await block();
  } finally {
    process.env = originalEnv;
  }
}
