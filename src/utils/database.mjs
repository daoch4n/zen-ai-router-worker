/**
 * Database utilities for Cloudflare D1 integration.
 * Provides mock database functionality to trigger worker location setting.
 */

/**
 * Forces Cloudflare Worker to establish its geographic location by performing
 * database operations. Creates and populates a mock comments table if needed.
 *
 * This function serves a specific purpose: Cloudflare Workers need to perform
 * certain operations to establish their geographic location for optimal routing.
 * Database access is one such operation that helps with this initialization.
 *
 * @param {Object} env - Cloudflare Worker environment variables
 * @param {Object} [env.MOCK_DB] - Cloudflare D1 database binding
 * @returns {Promise<Object|undefined>} Sample data from database or undefined if no DB
 */
export async function forceSetWorkerLocation(env) {
  if (!env.MOCK_DB) return;

  // Initialize comments table schema
  await env.MOCK_DB.prepare(`
      CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
      )
  `).run();

  // Check if table needs initial data
  const { count } = await env.MOCK_DB.prepare("SELECT COUNT(*) as count FROM comments").first();

  if (count === 0) {
      // Sample data for realistic database operations
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

      // Generate 5-10 random entries for realistic database activity
      const numEntities = Math.floor(Math.random() * 6) + 5;

      const insertStatements = Array.from({ length: numEntities }, () => {
          const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];
          const randomComment = randomComments[Math.floor(Math.random() * randomComments.length)];

          // Generate timestamps within the last 30 days
          const date = new Date();
          date.setDate(date.getDate() - Math.floor(Math.random() * 30));
          const randomDate = date.toISOString().replace('T', ' ').split('.')[0];

          return env.MOCK_DB.prepare(
              "INSERT INTO comments (author, content, created_at) VALUES (?, ?, ?)"
          ).bind(randomName, randomComment, randomDate);
      });

      // Execute batch insert for efficiency
      await env.MOCK_DB.batch(insertStatements);
  }

  // Return sample data to complete the database interaction
  return await env.MOCK_DB.prepare("SELECT * FROM comments LIMIT 2").all();
}
