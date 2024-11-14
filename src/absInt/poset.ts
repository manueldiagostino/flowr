export interface Poset<T> {

    /**
     * Checks if one element is less than or equal to another according to the partial order relation.
     * @param a - The first element to compare.
     * @param b - The second element to compare.
     * @returns `true` if `a` is less than or equal to `b`, `false` otherwise.
     */
    leq(a: T, b: T): boolean;

    /**
     * Finds the greatest common divisor (meet) of two elements if it exists.
     * @param a - The first element.
     * @param b - The second element.
     * @returns The greatest common element or `null` if it does not exist.
     */
    meet?(a: T, b: T): T | null;

    /**
     * Finds the least common multiple (join) of two elements if it exists.
     * @param a - The first element.
     * @param b - The second element.
     * @returns The least common element or `null` if it does not exist.
     */
    join?(a: T, b: T): T | null;

}