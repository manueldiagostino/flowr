export interface LatticeElement {
	readonly name: string;
	getName(): string;
	isEqual(other: LatticeElement): boolean;
}
