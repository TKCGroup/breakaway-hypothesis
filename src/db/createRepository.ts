import { InMemoryWatcherRepository, type WatcherRepository } from "./repository.js";
import { PostgresWatcherRepository, type PostgresRepositoryOptions } from "./postgresRepository.js";

export interface RepositoryHandle {
  repo: WatcherRepository;
  close: () => Promise<void>;
}

export function createRepository(
  databaseUrl = process.env.DATABASE_URL,
  options: PostgresRepositoryOptions = {}
): RepositoryHandle {
  if (!databaseUrl) {
    return {
      repo: new InMemoryWatcherRepository(),
      close: async () => {}
    };
  }

  const repo = PostgresWatcherRepository.fromConnectionString(databaseUrl, options);
  return {
    repo,
    close: () => repo.close()
  };
}
