import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../src/languages/cppAdapter.js';
import { JavaAdapter } from '../../src/languages/javaAdapter.js';
import { GoAdapter } from '../../src/languages/goAdapter.js';
import { RustAdapter } from '../../src/languages/rustAdapter.js';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';
import { CairoAdapter } from '../../src/languages/cairoAdapter.js';
import { CompactAdapter } from '../../src/languages/compactAdapter.js';
import { MoveAdapter } from '../../src/languages/moveAdapter.js';
import { NoirAdapter } from '../../src/languages/noirAdapter.js';
import { TolkAdapter } from '../../src/languages/tolkAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('Language Metrics', () => {
    describe('CppAdapter', () => {
        const adapter = new CppAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'test.cpp',
                content: `
                    #include <iostream>
                    
                    // This is a comment
                    void main() {
                        if (true) {
                            std::cout << "Hello";
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('JavaAdapter', () => {
        const adapter = new JavaAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'Test.java',
                content: `
                    public class Test {
                        /* Block comment */
                        public void main() {
                            for (int i=0; i<10; i++) {
                                System.out.println(i);
                            }
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('GoAdapter', () => {
        const adapter = new GoAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.go',
                content: `
                    package main
                    import "fmt"

                    // Comment
                    func main() {
                        if true {
                            fmt.Println("Hello")
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('RustAdapter', () => {
        const adapter = new RustAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.rs',
                content: `
                    fn main() {
                        // Comment
                        if true {
                            println!("Hello");
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('CairoAdapter', () => {
        const adapter = new CairoAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.cairo',
                content: `
                    fn main() {
                        // comment
                        if true {
                            let x = 1;
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('CompactAdapter', () => {
        const adapter = new CompactAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.compact',
                content: `
                    pragma compact ^0.1.0;
                    import "std";

                    circuit main() : Uint<32> {
                        // comment
                        if (true) {
                            return 1;
                        } else {
                            return 0;
                        }
                    }

                    circuit helper() : Boolean {
                        return true;
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('MoveAdapter', () => {
        const adapter = new MoveAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.move',
                content: `
                    module 0x1::M {
                        fun main() {
                            // comment
                            if (true) {
                                let x = 1;
                            };
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('NoirAdapter', () => {
        const adapter = new NoirAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.nr',
                content: `
                    fn main() {
                        // comment
                        if true {
                            let x = 1;
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('TolkAdapter', () => {
        const adapter = new TolkAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'main.tolk',
                content: `
                    fun main() {
                        // comment
                        if (true) {
                            let x = 1;
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });

    describe('SolidityAdapter', () => {
        const adapter = new SolidityAdapter();

        it('should calculate metrics correctly', async () => {
            const file: FileContent = {
                path: 'Contract.sol',
                content: `
                    contract C {
                        // Comment
                        function foo() {
                            if (true) {
                                revert();
                            }
                        }
                    }
                `
            };
            const metrics = await adapter.calculateMetrics([file]);
            expect(metrics[0].nloc).toBeGreaterThan(0);
            expect(metrics[0].linesWithComments).toBe(1);
            expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
        });
    });
});
