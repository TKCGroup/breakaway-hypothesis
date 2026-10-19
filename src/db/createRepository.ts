import { InMemoryWatcherRepository, type WatcherRepository } from "./repository.js";
import { PostgresWatcherRepository } from "./postgresRepository.js";

export interface RepositoryHandle {
  repo: WatcherRepository;
  close: () => Promise<void>;
}

export function createRepository(databaseUrl = process.env.DATABASE_URL): RepositoryHandle {
  if (!databaseUrl) {
    return {
      repo: new InMemoryWatcherRepository(),
      close: async () => {}
    };
  }

  const repo = PostgresWatcherRepository.fromConnectionString(databaseUrl);
  return {
    repo,
    close: () => repo.close()
  };
}

const sharedHandles = new Map<string, RepositoryHandle>();

// The HTTP server used to build a pool per request and end it in `finally`:
// each page load opened up to 5 fresh connections, and two overlapping loads
// plus a `/run` held 14-16. One pool per process, per database URL, is what a
// request borrows from. Its `close` is a no-op on purpose — a request must not
// end the pool another request is using. Process shutdown calls
// `closeSharedRepositories`.
export function sharedRepository(databaseUrl = process.env.DATABASE_URL): RepositoryHandle {
  const key = databaseUrl ?? "";
  const existing = sharedHandles.get(key);
  if (existing) {
    return { repo: existing.repo, close: async () => {} };
  }
  const handle = createRepository(databaseUrl);
  sharedHandles.set(key, handle);
  return { repo: handle.repo, close: async () => {} };
}

export async function closeSharedRepositories(): Promise<void> {
  const handles = [...sharedHandles.values()];
  sharedHandles.clear();
  await Promise.all(handles.map((handle) => handle.close()));
}
