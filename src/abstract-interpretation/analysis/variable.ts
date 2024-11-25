import type { Identifier } from './identifier';

export class Variable implements Identifier {
	id: string;

	constructor(lexeme: string) {
		this.id = lexeme;
	}

	equals(other: Variable): boolean {
		if(!(other instanceof Variable)) {
			return false;
		}
		return this.getId() === other.getId(); 
	}

	getId(): string {
		return this.id;
	}
}
