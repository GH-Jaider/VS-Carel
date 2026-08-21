/**
 * The interpreter's only platform dependency: a timer for the pause between
 * visible steps. Declared here instead of pulling in @types/node or the DOM
 * lib, so the package keeps zero dependencies and stays honest about running
 * anywhere the host provides a timer — browser, Node, Bun or a terminal.
 *
 * The handle is deliberately `unknown`: nothing in the core ever cancels it,
 * and typing it would tie the package to one runtime's return value.
 */
declare function setTimeout(handler: () => void, timeout?: number): unknown;
