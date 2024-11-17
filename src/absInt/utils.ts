export class EmptySet {
	private static instance: EmptySet;

	private constructor() { }

	static getInstance(): EmptySet {
		if(!EmptySet.instance) {
			EmptySet.instance = new EmptySet();
		}
		return EmptySet.instance;
	}

	toString(): string {
		return 'EMPTY_SET';
	}
}

