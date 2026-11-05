const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeJvmArgs, configureProperties } = require('../plugins/with-android-build-memory.cjs');

test('memory adjustment preserves other JVM arguments, including quoted values', () => {
  assert.equal(mergeJvmArgs('-Xms128m -Xmx2048m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8 -XX:+HeapDumpOnOutOfMemoryError -Dlabel="two words"'),
    '-Xms128m -Dfile.encoding=UTF-8 -XX:+HeapDumpOnOutOfMemoryError -Dlabel="two words" -Xmx1536m -XX:MaxMetaspaceSize=768m');
  assert.equal(mergeJvmArgs('-Dlabel="keep -Xmx123m here"'),
    '-Dlabel="keep -Xmx123m here" -Xmx1536m -XX:MaxMetaspaceSize=768m');
});

test('regeneration preserves unrelated properties and is idempotent', () => {
  const properties = [
    { type: 'comment', value: 'Keep this comment' },
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8' },
    { type: 'property', key: 'android.useAndroidX', value: 'true' },
    { type: 'property', key: 'org.gradle.parallel', value: 'true' },
  ];
  const result = configureProperties(properties);
  assert.deepEqual(configureProperties(result), result);
  assert.deepEqual(result[0], properties[0]);
  assert.ok(result.some((item) => item.key === 'android.useAndroidX' && item.value === 'true'));
  assert.ok(result.some((item) => item.key === 'org.gradle.jvmargs' && item.value === '-Dfile.encoding=UTF-8 -Xmx1536m -XX:MaxMetaspaceSize=768m'));
  assert.ok(result.some((item) => item.key === 'org.gradle.workers.max' && item.value === '1'));
  assert.ok(result.some((item) => item.key === 'org.gradle.parallel' && item.value === 'false'));
  assert.ok(result.some((item) => item.key === 'kotlin.compiler.execution.strategy' && item.value === 'in-process'));
  assert.equal(properties[1].value, '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8');
});

test('duplicate JVM settings retain the effective last setting without duplicate caps', () => {
  const result = configureProperties([
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Dold=true -Xmx2048m' },
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Dactual=true -Xmx1024m -Xmx512m' },
  ]).filter((item) => item.key === 'org.gradle.jvmargs');
  assert.equal(result.length, 1);
  assert.equal(result[0].value, '-Dactual=true -Xmx1536m -XX:MaxMetaspaceSize=768m');
});
