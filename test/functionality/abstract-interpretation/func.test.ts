import { describe, it, expect } from 'vitest';
import { Func } from '../../../src/abstract-interpretation/analysis/function';

describe('Func class tests', () => {
	describe('Constructor and basic functionality', () => {
		it('should initialize with the correct name', () => {
			const func = new Func<string, number>('testFunc');
			expect(func.getName()).toBe('testFunc');
		});

		it('should initialize with an empty map', () => {
			const func = new Func<string, number>('testFunc');
			expect(func.getElements()).toEqual([]);
		});
	});

	describe('apply method', () => {
		it('should correctly return the value for a mapped key', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('x', 42);
			expect(func.apply('x')).toBe(42);
		});

		it('should throw an error for an unmapped key', () => {
			const func = new Func<string, number>('testFunc');
			expect(() => func.apply('missingKey')).toThrowError(
				'Element missingKey is not mapped in function testFunc'
			);
		});

		it('should not throw errors for keys with falsy values', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('zero', 0);
			expect(func.apply('zero')).toBe(0);
		});
	});

	describe('updateElement method', () => {
		it('should add a new element', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('a', 10);
			expect(func.apply('a')).toBe(10);
		});

		it('should overwrite an existing element', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('a', 10);
			func.updateElement('a', 20);
			expect(func.apply('a')).toBe(20);
		});

	});

	describe('updateElements method', () => {
		it('should add multiple elements correctly', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElements(['a', 'b', 'c'], [1, 2, 3]);
			expect(func.apply('a')).toBe(1);
			expect(func.apply('b')).toBe(2);
			expect(func.apply('c')).toBe(3);
		});

		it('should throw an error if arrays are of mismatched lengths', () => {
			const func = new Func<string, number>('testFunc');
			expect(() => func.updateElements(['a', 'b'], [1])).toThrowError(
				'The number of elements and values must match.'
			);
		});

		it('should overwrite existing keys', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElements(['a', 'b'], [1, 2]);
			func.updateElements(['a', 'b'], [3, 4]);
			expect(func.apply('a')).toBe(3);
			expect(func.apply('b')).toBe(4);
		});
	});

	describe('remove method', () => {
		it('should remove an element and return true if it exists', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('a', 10);
			expect(func.remove('a')).toBe(true);
			expect(() => func.apply('a')).toThrowError(
				'Element a is not mapped in function testFunc'
			);
		});
  
		it('should return false for a non-existent key', () => {
			const func = new Func<string, number>('testFunc');
			expect(func.remove('missingKey')).toBe(false);
		});
  
		it('should check key existence before attempting removal', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('a', 10);
			expect(func.remove('a')).toBe(true);
			expect(func.remove('a')).toBe(false);
		});
  
		it('should handle removing complex keys', () => {
			const func = new Func<object, string>('testFunc');
			const obj = { key: 'value' };
			func.updateElement(obj, 'test');
			expect(func.remove(obj)).toBe(true);
		});
	});
  

	describe('getElements method', () => {
		it('should return an empty array for an empty map', () => {
			const func = new Func<string, number>('testFunc');
			expect(func.getElements()).toEqual([]);
		});

		it('should return all keys in the map', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElements(['a', 'b', 'c'], [1, 2, 3]);
			expect(func.getElements()).toEqual(['a', 'b', 'c']);
		});

		it('should reflect changes after removing elements', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElements(['a', 'b', 'c'], [1, 2, 3]);
			func.remove('b');
			expect(func.getElements()).toEqual(['a', 'c']);
		});
	});

	describe('hasKey method', () => {
		it('should return true for existing keys', () => {
			const func = new Func<string, number>('testFunc');
			func.updateElement('a', 1);
			expect(func.hasKey('a')).toBe(true);
		});

		it('should return false for non-existent keys', () => {
			const func = new Func<string, number>('testFunc');
			expect(func.hasKey('missingKey')).toBe(false);
		});

		it('should handle complex keys', () => {
			const func = new Func<object, number>('testFunc');
			const obj = { key: 'value' };
			func.updateElement(obj, 42);
			expect(func.hasKey(obj)).toBe(true);
		});
	});

	describe('isEqual method', () => {
		it('should return true for equal functions', () => {
			const func1 = new Func<string, number>('func1');
			const func2 = new Func<string, number>('func2');

			func1.updateElements(['a', 'b'], [1, 2]);
			func2.updateElements(['a', 'b'], [1, 2]);

			expect(func1.isEqual(func2)).toBe(true);
		});

		it('should return false for functions with different sizes', () => {
			const func1 = new Func<string, number>('func1');
			const func2 = new Func<string, number>('func2');

			func1.updateElements(['a', 'b'], [1, 2]);
			func2.updateElement('a', 1);

			expect(func1.isEqual(func2)).toBe(false);
		});

		it('should return false for functions with different mappings', () => {
			const func1 = new Func<string, number>('func1');
			const func2 = new Func<string, number>('func2');

			func1.updateElements(['a', 'b'], [1, 2]);
			func2.updateElements(['a', 'b'], [1, 3]);

			expect(func1.isEqual(func2)).toBe(false);
		});

		it('should correctly compare empty functions', () => {
			const func1 = new Func<string, number>('func1');
			const func2 = new Func<string, number>('func2');

			expect(func1.isEqual(func2)).toBe(true);
		});
	});
});
