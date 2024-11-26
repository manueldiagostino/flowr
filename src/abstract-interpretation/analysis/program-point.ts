import type { SourceRange } from '../../util/range';

export class ProgramPoint {
	startLine:   number;
	startColumn: number;
	endLine:     number;
	endColumn:   number;

	constructor(range: SourceRange) {
		this.startLine = range[0];
		this.startColumn = range[1];
		this.endLine = range[2];
		this.endColumn = range[3];
	}

	toString(): string {
		return `Start: (${this.startLine}, ${this.startColumn}), End: (${this.endLine}, ${this.endColumn})`;
	}

	contains(line: number, column: number): boolean {
		return (
			(line > this.startLine || (line === this.startLine && column >= this.startColumn)) &&
            (line < this.endLine || (line === this.endLine && column <= this.endColumn))
		);
	}
}
