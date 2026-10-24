const { add, subtract, multiply, divide } = require('../src/services/calculator');

describe('Calculator Service', () => {
  test('should add two numbers', () => {
    expect(add(10, 5)).toBe(15);
  });

  test('should subtract two numbers', () => {
    expect(subtract(10, 5)).toBe(5);
  });

  test('should multiply two numbers', () => {
    expect(multiply(10, 5)).toBe(50);
  });

  test('should divide two numbers', () => {
    expect(divide(10, 5)).toBe(2);
  });

  test('should support decimal numbers', () => {
    expect(add(10.5, 2.5)).toBe(13);
  });

  test('should throw error when dividing by zero', () => {
    expect(() => divide(10, 0)).toThrow('Cannot divide by zero');
  });
});
