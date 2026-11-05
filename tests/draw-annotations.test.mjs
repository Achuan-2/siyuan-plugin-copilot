import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function module(path) {
    const context = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return context.exports;
}
const annotations = module('../src/utils/drawAnnotations.ts');
const gallery = module('../src/utils/drawGallery.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const region = (id, comment) => ({ id, x: .1, y: .2, width: .3, height: .4, comment });
const image = name => ({ type: 'image', name, data: `blob:${name}`, path: `/data/${name}.png` });
const marked = name => ({ ...image(name), drawAnnotations: {
    imagePath: `/data/${name}-guide.png`, regions: [region('first', ' 改进物镜轮廓 '), region('second', '保留其他部分')],
} });

test('宽高比留白不参与标注，拖出边缘可裁到图片范围，反向框选得到同一原图区域', () => {
    const rect = { left: 10, top: 20, width: 600, height: 400 };
    assert.equal(annotations.getAnnotationPoint(60, 100, rect, 800, 800), null);
    assert.deepEqual(plain(annotations.getAnnotationPoint(310, 220, rect, 800, 800)), { x: .5, y: .5 });
    assert.deepEqual(plain(annotations.getAnnotationPoint(-100, 600, rect, 800, 800, true)), { x: 0, y: 1 });
    assert.equal(annotations.getAnnotationPoint(1, 1, rect, 0, 0), null);
    const forward = annotations.createDrawAnnotation({ x: .1, y: .2 }, { x: .8, y: .9 }, 'r');
    const reverse = annotations.createDrawAnnotation({ x: .8, y: .9 }, { x: .1, y: .2 }, 'r');
    assert.deepEqual(plain(reverse), plain(forward));
    assert.equal(reverse.x, .1);
    assert.equal(reverse.y, .2);
});

test('标注在原始分辨率绘制且编号与评论顺序一致，导出不带编辑器选中态', () => {
    const calls = [];
    const context = Object.fromEntries(['save', 'restore', 'beginPath', 'arc', 'fill', 'fillText', 'strokeRect']
        .map(name => [name, (...args) => calls.push([name, ...args])]));
    const regions = [region('a', 'first'), region('b', 'second')];
    annotations.paintDrawAnnotations(context, 4000, 2000, regions);
    assert.deepEqual(calls.filter(call => call[0] === 'strokeRect')[0], ['strokeRect', 400, 400, 1200, 800]);
    assert.deepEqual(calls.filter(call => call[0] === 'fillText').map(call => call[1]), ['1', '2']);
    assert.equal(context.strokeStyle, '#ff3b30');
    assert.equal(context.fillStyle, '#ffffff');
    assert.equal(calls[0][0], 'save');
    assert.equal(calls.at(-1)[0], 'restore');
});

test('模型只接收干净原图，多个参考图的文本坐标评论对应正确且不上传标记', () => {
    const images = [image('plain'), marked('reference'), marked('another')];
    const before = JSON.stringify(images);
    const request = annotations.createDrawRequestReferences(images);
    assert.deepEqual(plain(request).map(image => image.path), ['/data/plain.png', '/data/reference.png', '/data/another.png']);
    assert.ok(request.every(image => !image.drawAnnotations));
    assert.ok(!JSON.stringify(request).includes('-guide.png'));
    const prompt = annotations.buildDrawAnnotationPrompt('只修改指定区域', images);
    assert.match(prompt, /Input image 2 \(reference\):/);
    assert.match(prompt, /Input image 3 \(another\):/);
    assert.match(prompt, /1\. Region \(left 10%, top 20%, width 30%, height 40%\): 改进物镜轮廓/);
    assert.match(prompt, /do not draw region boundaries/);
    assert.match(prompt, /top-left corner/);
    assert.ok(!prompt.includes('annotated guide image'));
    assert.equal(JSON.stringify(images), before);
    assert.equal(annotations.hasDrawAnnotationComments(images), true);
});

test('清空标注后不附加标注提示词，标注预览缺失也能使用坐标评论', () => {
    const images = [image('original')];
    assert.equal(annotations.buildDrawAnnotationPrompt('keep prompt', images), 'keep prompt');
    assert.equal(annotations.createDrawRequestReferences(images).length, 1);
    assert.equal(annotations.hasDrawAnnotationComments(images), false);
    const withoutPreview = [{ ...marked('valid'), drawAnnotations: { imagePath: '', regions: [region('x', 'comment')] } }];
    assert.equal(annotations.hasDrawAnnotationComments(withoutPreview), true);
    assert.equal(annotations.createDrawRequestReferences(withoutPreview).length, 1);
    assert.match(annotations.buildDrawAnnotationPrompt('edit', withoutPreview), /comment/);
});

test('生成快照保存原图和可编辑标注，后续修改草稿不改变已发送评论', () => {
    const original = marked('original');
    const snapshot = gallery.snapshotDrawReferences([original]);
    original.drawAnnotations.regions[0].comment = 'changed later';
    assert.equal(snapshot[0].drawAnnotations.regions[0].comment, ' 改进物镜轮廓 ');
    assert.equal(snapshot[0].path, '/data/original.png');
    assert.equal(snapshot[0].data, '');
    assert.equal(snapshot[0].drawAnnotations.imagePath, '/data/original-guide.png');
    const reopened = plain(snapshot);
    assert.equal(annotations.createDrawRequestReferences(reopened).length, 1);
    assert.match(annotations.buildDrawAnnotationPrompt('retry', reopened), /改进物镜轮廓/);
});
