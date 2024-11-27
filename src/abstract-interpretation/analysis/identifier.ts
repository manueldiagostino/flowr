export interface Identifier {
	id: string;
	getId(): string;
	equals(other: Identifier): boolean;
}