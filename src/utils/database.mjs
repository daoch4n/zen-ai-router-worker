/**
 * Database utilities for Cloudflare D1
 */

/**
 * Forces the worker to set the location by connecting to a mocked database
 * @param {Object} env - The environment variables
 * @returns {Promise<Object>} - Sample data from the database
 */
export async function forceSetWorkerLocation(env) {
  if (!env.MOCK_DB) return;

  // Create table if it doesn't exist
  await env.MOCK_DB.prepare(`
      CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
      )
  `).run();

  // Check if table is empty
  const { count } = await env.MOCK_DB.prepare("SELECT COUNT(*) as count FROM comments").first();

  if (count === 0) {
      // Random data generators
      const randomNames = [
          "Emma", "Liam", "Olivia", "Noah", "Ava", "James", "Isabella", "Oliver",
          "Sophia", "William", "Mia", "Lucas", "Charlotte", "Mason", "Amelia"
      ];

      const randomComments = [
          "Absolutely fantastic!", "Could be better", "Really impressed",
          "Great experience", "Nice work", "Needs improvement",
          "Outstanding service", "Very responsive", "Amazing features",
          "Love the interface", "Quick and efficient", "Highly reliable"
      ];

      // Generate random number of entities (between 5 and 10)
      const numEntities = Math.floor(Math.random() * 6) + 5;

      // Generate random entries
      const insertStatements = Array.from({ length: numEntities }, () => {
          const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];
          const randomComment = randomComments[Math.floor(Math.random() * randomComments.length)];

          // Generate random date within last 30 days
          const date = new Date();
          date.setDate(date.getDate() - Math.floor(Math.random() * 30));
          const randomDate = date.toISOString().replace('T', ' ').split('.')[0];

          return env.MOCK_DB.prepare(
              "INSERT INTO comments (author, content, created_at) VALUES (?, ?, ?)"
          ).bind(randomName, randomComment, randomDate);
      });

      // Execute all inserts in a batch
      await env.MOCK_DB.batch(insertStatements);
  }

  // Return sample data
  return await env.MOCK_DB.prepare("SELECT * FROM comments LIMIT 2").all();
}
