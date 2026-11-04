import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/replyRendering.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = { exports: {}, console };
vm.runInNewContext(compiled, sandbox);
const { ReplyRenderScheduler, ReplyMarkdownRenderer } = sandbox.exports;

function clock() {
    let now = 0;
    let id = 0;
    const timers = new Map();
    return {
        now: () => now,
        schedule(callback, delay) { timers.set(++id, { callback, time: now + delay }); return id; },
        cancel: id => timers.delete(id),
        get pending() { return timers.size; },
        async advance(time) {
            now = time;
            for (const [id, timer] of [...timers]) {
                if (timer.time <= now) { timers.delete(id); timer.callback(); }
            }
            // Drain the scheduler and a potentially asynchronous render callback.
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

test('first render is immediate; burst updates coalesce without delaying the final render', async () => {
    const timer = clock();
    let renders = 0;
    const scheduler = new ReplyRenderScheduler(() => { renders++; }, 100, timer);
    scheduler.request();
    await timer.advance(0);
    assert.equal(renders, 1);
    for (let token = 0; token < 100; token++) scheduler.request();
    assert.equal(timer.pending, 1);
    await timer.advance(99);
    assert.equal(renders, 1);
    await timer.advance(100);
    assert.equal(renders, 2);
    scheduler.request();
    scheduler.request(true);
    assert.equal(timer.pending, 1);
    await timer.advance(101);
    assert.equal(renders, 3);
    assert.equal(timer.pending, 0);
});

test('asynchronous rendering never overlaps and uses the latest content once ready', async () => {
    const timer = clock();
    let release;
    let content = 'first';
    const seen = [];
    const scheduler = new ReplyRenderScheduler(async () => {
        seen.push(content);
        if (seen.length === 1) await new Promise(resolve => { release = resolve; });
    }, 100, timer);
    scheduler.request();
    await timer.advance(0);
    content = 'latest';
    for (let token = 0; token < 100; token++) scheduler.request();
    assert.equal(timer.pending, 0);
    assert.deepEqual(seen, ['first']);
    release();
    await timer.advance(100);
    await timer.advance(100);
    assert.deepEqual(seen, ['first', 'latest']);
});

test('disposal cancels queued work and prevents reruns after an in-flight render', async () => {
    const timer = clock();
    let release;
    let renders = 0;
    const scheduler = new ReplyRenderScheduler(async () => {
        renders++;
        await new Promise(resolve => { release = resolve; });
    }, 100, timer);
    scheduler.request();
    await timer.advance(0);
    scheduler.request(true);
    scheduler.dispose();
    release();
    await timer.advance(100);
    scheduler.request();
    await timer.advance(200);
    assert.equal(renders, 1);
    assert.equal(timer.pending, 0);

    const queued = new ReplyRenderScheduler(() => { renders++; }, 100, timer);
    queued.request();
    queued.dispose();
    await timer.advance(300);
    assert.equal(renders, 1);
});

test('render failures are reported and do not block later updates', async () => {
    const timer = clock();
    const errors = [];
    let renders = 0;
    const scheduler = new ReplyRenderScheduler(() => {
        if (++renders === 1) throw new Error('fixture error');
    }, 100, timer, error => errors.push(error.message));
    scheduler.request();
    await timer.advance(0);
    scheduler.request();
    await timer.advance(100);
    assert.equal(renders, 2);
    assert.deepEqual(errors, ['fixture error']);
});

test('Markdown renderer reuses one engine and unchanged HTML, then evicts old entries', () => {
    let engines = 0;
    let parses = 0;
    const renderer = new ReplyMarkdownRenderer(() => {
        engines++;
        return { Md2HTML: text => { parses++; return `<p>${text}</p>`; } };
    }, 2);
    assert.equal(renderer.render('one'), '<p>one</p>');
    assert.equal(renderer.render('one'), '<p>one</p>');
    renderer.render('two');
    renderer.render('one');
    renderer.render('three');
    assert.equal(engines, 1);
    assert.equal(parses, 3);
    renderer.render('two');
    assert.equal(parses, 4);
});

test('cache obeys its character budget and retries when Lute loads later', () => {
    let ready = false;
    let parses = 0;
    const renderer = new ReplyMarkdownRenderer(() => ready ? {
        Md2HTML: text => { parses++; return text; },
    } : undefined, 64, 10);
    assert.equal(renderer.render('one'), undefined);
    ready = true;
    renderer.render('one');
    renderer.render('two');
    renderer.render('one');
    assert.equal(parses, 3);
    renderer.render('oversized');
    renderer.render('oversized');
    assert.equal(parses, 5);
    assert.equal(renderer.render('one'), 'one');
    assert.equal(parses, 5);
});
