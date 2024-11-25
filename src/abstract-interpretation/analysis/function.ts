import type { LatticeElement } from './lattice-element';

export interface Functional<A, B> extends LatticeElement {
	apply(elem: A): B;
	updateElement(elem: A, value: B): void;
	updateElements(elems: A[], values: B[]): void;
	remove(elem: A): boolean;
	getElements(): A[];
	hasKey(key: A): boolean;
}

export class Func<A, B> implements Functional<A, B> {
	readonly f: Map<A, B>;
	name:       string;

	public constructor(name: string) {
		this.name = name;
		this.f = new Map<A, B>();
	}

	isEqual(other: Func<A, B>): boolean {
		if(this.f.size !== other.f.size) {
			return false;
		}

		for(const [key, value] of this.f.entries()) {
			if(!other.f.has(key) || other.f.get(key) !== value) {
				return false;
			}
		}
		return true;
	}

	getName(): string {
		return this.name;
	}

	apply(elem: A): B {
		const value = this.f.get(elem);
		if(value === undefined) {
			throw new Error(`Element ${String(elem)} is not mapped in function ${this.name}`);
		}
		return value;
	}

	updateElement(elem: A, value: B): void {
		this.f.set(elem, value);
	}

	updateElements(elems: A[], values: B[]): void {
		if(elems.length !== values.length) {
			throw new Error('The number of elements and values must match.');
		}
		for(let i = 0; i < elems.length; i++) {
			this.f.set(elems[i], values[i]);
		}
	}

	remove(elem: A): boolean {
		return this.f.delete(elem);
	}

	getElements(): A[] {
		return Array.from(this.f.keys());
	}

	hasKey(key: A): boolean {
		return this.f.has(key);
	}
	
}


export class ConstantFunc<A, B> extends Func<A, B> {
	value: B;

	public constructor(name: string, value: B) {
		super(name);
		this.value = value;
	}
	isEqual(_other: Func<unknown, unknown>): boolean {
		throw new Error('Method not implemented.');
	}
	getName(): string {
		throw new Error('Method not implemented.');
	}
	apply(_elem: A): B {
		return this.value;
	}
	updateElement(_elem: A, _value: B): void {
		throw new Error('Method not implemented.');
	}
	updateElements(_elems: A[], _values: B[]): void {
		throw new Error('Method not implemented.');
	}
	remove(_elem: A): boolean {
		throw new Error('Method not implemented.');
	}
	getElements(): A[] {
		throw new Error('Method not implemented.');
	}
}
