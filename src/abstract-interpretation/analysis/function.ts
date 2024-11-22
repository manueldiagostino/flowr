import type { LatticeElement } from './lattice-element';

export interface Functional<A, B> extends LatticeElement {
	apply(elem: A): B;
	updateElement(elem: A, value: B): void;
	updateElements(elems: A[], values: B[]): void;
	remove(elem: A): boolean;
	getElements(): A[];
}

export class Func<A, B> implements Functional<A, B> {
	private f: Map<A, B>;
	name:      string;

	public constructor(name: string) {
		this.name = name;
		this.f = new Map<A, B>();
	}

	isEqual(_other: Func<unknown, unknown>): boolean {
		throw new Error('Method not implemented.');
	}

	getName(): string {
		return this.name;
	}

	apply(_elem: A): B {
		throw new Error('Method not implemented.');
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
