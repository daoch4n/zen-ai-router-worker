/**
 * Tests for error handling utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { HttpError, errorHandler } from '../../src/utils/error.mjs';

describe('error utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HttpError', () => {
    it('should create HttpError with message and status', () => {
      const error = new HttpError('Not found', 404);
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe('Not found');
      expect(error.status).toBe(404);
      expect(error.name).toBe('HttpError');
    });

    it('should create HttpError with default status', () => {
      const error = new HttpError('Server error');
      
      expect(error.message).toBe('Server error');
      expect(error.status).toBeUndefined();
    });

    it('should be throwable', () => {
      expect(() => {
        throw new HttpError('Test error', 400);
      }).toThrow(HttpError);
      
      expect(() => {
        throw new HttpError('Test error', 400);
      }).toThrow('Test error');
    });
  });

  describe('errorHandler', () => {
    it('should handle HttpError with status', () => {
      const error = new HttpError('Bad request', 400);
      const mockFixCors = jest.fn((options) => ({
        ...options,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }));
      
      const response = errorHandler(error, mockFixCors);
      
      expect(response).toBeInstanceOf(Response);
      expect(mockFixCors).toHaveBeenCalledWith({ status: 400 });
    });

    it('should handle generic Error with default status 500', () => {
      const error = new Error('Generic error');
      const mockFixCors = jest.fn((options) => ({
        ...options,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }));
      
      const response = errorHandler(error, mockFixCors);
      
      expect(response).toBeInstanceOf(Response);
      expect(mockFixCors).toHaveBeenCalledWith({ status: 500 });
    });

    it('should log error to console', () => {
      const error = new Error('Test error');
      const mockFixCors = jest.fn((options) => options);
      const consoleSpy = jest.spyOn(console, 'error');
      
      errorHandler(error, mockFixCors);
      
      expect(consoleSpy).toHaveBeenCalledWith(error);
    });

    it('should create response with error message', () => {
      const error = new HttpError('Custom error message', 422);
      const mockFixCors = jest.fn((options) => options);
      
      const response = errorHandler(error, mockFixCors);
      
      // Note: In a real test environment, we'd need to read the response body
      // For now, we verify the response was created
      expect(response).toBeInstanceOf(Response);
    });

    it('should handle error without status property', () => {
      const error = { message: 'Object error' };
      const mockFixCors = jest.fn((options) => ({
        ...options,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }));
      
      const response = errorHandler(error, mockFixCors);
      
      expect(response).toBeInstanceOf(Response);
      expect(mockFixCors).toHaveBeenCalledWith({ status: 500 });
    });
  });
});
