const loaderUrl = 'file:///D:/app/DeepSeek%20Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-typert-loader/lib/index.js'
const mod = await import(loaderUrl)
console.log('exports:', Object.keys(mod))
const mine = await import('file:///E:/%E5%B7%A5%E4%BD%9C%E5%8F%B0/01-%E9%A1%B9%E7%9B%AE/%E8%BF%9B%E8%A1%8C%E4%B8%AD/DSH-%E8%BE%93%E5%85%A5%E4%BC%98%E5%8C%96%E6%8F%92%E4%BB%B6/plugin/lib/typert.host.js')
try {
  const result = mod.validateTypertManifest('dsh-prompt-polish', mine.TYPERT)
  console.log('校验通过:', JSON.stringify(result)?.slice(0, 400))
} catch (error) {
  console.log('校验失败:', error.message)
}
