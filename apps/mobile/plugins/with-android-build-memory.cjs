const { withGradleProperties } = require('@expo/config-plugins');

function mergeJvmArgs(value = '') {
  // Keep quoted system properties and every non-memory option intact.
  const tokens = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const kept = tokens.filter((token) =>
    !token.startsWith('-Xmx') && !token.startsWith('-XX:MaxMetaspaceSize='));
  return [...kept, '-Xmx1536m', '-XX:MaxMetaspaceSize=768m'].join(' ');
}

function configureProperties(properties) {
  const effectiveJvmArgs = properties.filter((item) =>
    item.type === 'property' && item.key === 'org.gradle.jvmargs').at(-1)?.value;
  const values = {
    'org.gradle.jvmargs': mergeJvmArgs(effectiveJvmArgs),
    'org.gradle.workers.max': '1',
    'org.gradle.parallel': 'false',
    'kotlin.compiler.execution.strategy': 'in-process',
  };
  const seen = new Set();
  const result = [];
  for (const item of properties) {
    if (item.type !== 'property' || !Object.hasOwn(values, item.key)) {
      result.push(item);
    } else if (!seen.has(item.key)) {
      result.push({ ...item, value: values[item.key] });
      seen.add(item.key);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) result.push({ type: 'property', key, value });
  }
  return result;
}

module.exports = (config) => withGradleProperties(config, (mod) => {
  mod.modResults = configureProperties(mod.modResults);
  return mod;
});
module.exports.mergeJvmArgs = mergeJvmArgs;
module.exports.configureProperties = configureProperties;
