const cordis = await import('file:///D:/app/DeepSeek%20Harness/resources/app/dsh/node_modules/@deepseek-ai/cordis/lib/index.js')
console.log('cordis exports:', Object.keys(cordis).slice(0, 12))
const plugin = await import('file:///E:/%E5%B7%A5%E4%BD%9C%E5%8F%B0/01-%E9%A1%B9%E7%9B%AE/%E8%BF%9B%E8%A1%8C%E4%B8%AD/DSH-%E8%BE%93%E5%85%A5%E4%BC%98%E5%8C%96%E6%8F%92%E4%BB%B6/plugin/lib/index.js')
console.log('plugin exports:', Object.keys(plugin))
const ctx = new (cordis.Context ?? cordis.default)()
try {
  await ctx.plugin(plugin, {})
  await new Promise((r) => setTimeout(r, 300))
  console.log('service:', typeof ctx.get('promptPolish'), ctx.get('promptPolish') ? Object.keys(ctx.get('promptPolish')) : null)
  console.log('remote marker:', Reflect.get(ctx.get('promptPolish') ?? {}, 'typertRemote') !== undefined)
} catch (error) {
  console.log('apply 抛错:', error?.message)
  console.log(error?.stack?.split('\n').slice(0, 6).join('\n'))
}
