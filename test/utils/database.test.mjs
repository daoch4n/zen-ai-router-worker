/**
 * Tests for database utilities
 * Tests mock database operations and worker location setting
 */

import { jest } from '@jest/globals';
import { forceSetWorkerLocation } from '../../src/utils/database.mjs';

describe('Database Utilities', () => {
  let mockDB;
  let mockEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock D1 database interface
    mockDB = {
      prepare: jest.fn(),
      batch: jest.fn()
    };

    mockEnv = {
      MOCK_DB: mockDB
    };

    // Setup default mock chain
    const mockStatement = {
      run: jest.fn().mockResolvedValue({ success: true }),
      first: jest.fn().mockResolvedValue({ count: 0 }),
      all: jest.fn().mockResolvedValue({ results: [] }),
      bind: jest.fn().mockReturnThis()
    };

    mockDB.prepare.mockReturnValue(mockStatement);
    mockDB.batch.mockResolvedValue([{ success: true }]);
  });

  describe('forceSetWorkerLocation', () => {
    test('should return early when MOCK_DB is not provided', async () => {
      const envWithoutDB = {};
      
      const result = await forceSetWorkerLocation(envWithoutDB);
      
      expect(result).toBeUndefined();
      expect(mockDB.prepare).not.toHaveBeenCalled();
    });

    test('should create comments table if it does not exist', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 0 }),
        all: jest.fn().mockResolvedValue({ results: [
          { id: 1, author: 'Test', content: 'Test comment', created_at: '2024-01-01 12:00:00' }
        ] }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      const result = await forceSetWorkerLocation(mockEnv);

      expect(mockDB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS comments')
      );
      expect(mockStatement.run).toHaveBeenCalled();
    });

    test('should check if comments table is empty', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 0 }),
        all: jest.fn().mockResolvedValue({ results: [] }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      await forceSetWorkerLocation(mockEnv);

      expect(mockDB.prepare).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM comments'
      );
      expect(mockStatement.first).toHaveBeenCalled();
    });

    test('should insert random data when table is empty', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 0 }),
        all: jest.fn().mockResolvedValue({ results: [
          { id: 1, author: 'Emma', content: 'Great experience', created_at: '2024-01-01 12:00:00' },
          { id: 2, author: 'Liam', content: 'Nice work', created_at: '2024-01-02 12:00:00' }
        ] }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      const result = await forceSetWorkerLocation(mockEnv);

      // Should prepare insert statements
      expect(mockDB.prepare).toHaveBeenCalledWith(
        'INSERT INTO comments (author, content, created_at) VALUES (?, ?, ?)'
      );

      // Should bind parameters for each insert
      expect(mockStatement.bind).toHaveBeenCalled();

      // Should execute batch insert
      expect(mockDB.batch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            bind: expect.any(Function)
          })
        ])
      );

      // Should return sample data
      expect(result).toEqual({
        results: [
          { id: 1, author: 'Emma', content: 'Great experience', created_at: '2024-01-01 12:00:00' },
          { id: 2, author: 'Liam', content: 'Nice work', created_at: '2024-01-02 12:00:00' }
        ]
      });
    });

    test('should not insert data when table already has records', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 5 }), // Table has existing data
        all: jest.fn().mockResolvedValue({ results: [
          { id: 1, author: 'Existing', content: 'Existing comment', created_at: '2024-01-01 12:00:00' }
        ] }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      const result = await forceSetWorkerLocation(mockEnv);

      // Should not call batch insert when table has data
      expect(mockDB.batch).not.toHaveBeenCalled();

      // Should still return sample data
      expect(result).toEqual({
        results: [
          { id: 1, author: 'Existing', content: 'Existing comment', created_at: '2024-01-01 12:00:00' }
        ]
      });
    });

    test('should generate random data within expected ranges', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 0 }),
        all: jest.fn().mockResolvedValue({ results: [] }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      await forceSetWorkerLocation(mockEnv);

      // Check that batch was called with an array of statements
      expect(mockDB.batch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            bind: expect.any(Function)
          })
        ])
      );

      // Get the batch call arguments to verify the number of inserts
      const batchCall = mockDB.batch.mock.calls[0];
      const insertStatements = batchCall[0];
      
      // Should generate between 5 and 10 entities
      expect(insertStatements.length).toBeGreaterThanOrEqual(5);
      expect(insertStatements.length).toBeLessThanOrEqual(10);
    });

    test('should use predefined names and comments', async () => {
      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 0 }),
        all: jest.fn().mockResolvedValue({ results: [] }),
        bind: jest.fn()
      };

      // Capture bind calls to verify data
      const bindCalls = [];
      mockStatement.bind.mockImplementation((...args) => {
        bindCalls.push(args);
        return mockStatement;
      });

      mockDB.prepare.mockReturnValue(mockStatement);

      await forceSetWorkerLocation(mockEnv);

      // Verify that bind was called with valid names and comments
      expect(bindCalls.length).toBeGreaterThan(0);
      
      const expectedNames = [
        "Emma", "Liam", "Olivia", "Noah", "Ava", "James", "Isabella", "Oliver",
        "Sophia", "William", "Mia", "Lucas", "Charlotte", "Mason", "Amelia"
      ];
      
      const expectedComments = [
        "Absolutely fantastic!", "Could be better", "Really impressed",
        "Great experience", "Nice work", "Needs improvement",
        "Outstanding service", "Very responsive", "Amazing features",
        "Love the interface", "Quick and efficient", "Highly reliable"
      ];

      bindCalls.forEach(([name, comment, date]) => {
        expect(expectedNames).toContain(name);
        expect(expectedComments).toContain(comment);
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // Date format validation
      });
    });

    test('should return sample data from the database', async () => {
      const sampleData = [
        { id: 1, author: 'Test User 1', content: 'Test comment 1', created_at: '2024-01-01 12:00:00' },
        { id: 2, author: 'Test User 2', content: 'Test comment 2', created_at: '2024-01-02 12:00:00' }
      ];

      const mockStatement = {
        run: jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({ count: 5 }),
        all: jest.fn().mockResolvedValue({ results: sampleData }),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      const result = await forceSetWorkerLocation(mockEnv);

      expect(mockDB.prepare).toHaveBeenCalledWith('SELECT * FROM comments LIMIT 2');
      expect(result).toEqual({ results: sampleData });
    });

    test('should handle database errors gracefully', async () => {
      const mockStatement = {
        run: jest.fn().mockRejectedValue(new Error('Database error')),
        first: jest.fn(),
        all: jest.fn(),
        bind: jest.fn().mockReturnThis()
      };

      mockDB.prepare.mockReturnValue(mockStatement);

      await expect(forceSetWorkerLocation(mockEnv)).rejects.toThrow('Database error');
    });
  });
});
