<script setup lang="ts">
const props = defineProps<{
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
}>()
const emit = defineEmits<{
  (e: 'update:fontSize', v: number): void
  (e: 'update:fontFamily', v: string): void
  (e: 'update:lineHeight', v: number): void
  (e: 'update:cursorStyle', v: 'block' | 'underline' | 'bar'): void
  (e: 'update:cursorBlink', v: boolean): void
  (e: 'close'): void
  (e: 'reset'): void
}>()

const FONT_OPTIONS = [
  'Menlo, Monaco, Consolas, "Courier New", monospace',
  '"Fira Code", Menlo, Monaco, monospace',
  '"JetBrains Mono", Menlo, Monaco, monospace',
  '"Cascadia Code", Menlo, Monaco, monospace',
  '"SF Mono", Menlo, Monaco, monospace',
  'Consolas, "Courier New", monospace',
  'monospace',
]

function onFontSelect(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v !== '__custom__') emit('update:fontFamily', v)
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h3>终端外观设置</h3>
      <p class="sub">修改后立即对所有已打开的终端标签生效,不需要重新连接。</p>

      <label>字号:{{ fontSize }}px</label>
      <input
        type="range"
        min="10"
        max="24"
        step="1"
        :value="fontSize"
        @input="emit('update:fontSize', Number(($event.target as HTMLInputElement).value))"
      />

      <label>字体</label>
      <select :value="FONT_OPTIONS.includes(fontFamily) ? fontFamily : '__custom__'" @change="onFontSelect">
        <option v-for="f in FONT_OPTIONS" :key="f" :value="f">{{ f.split(',')[0].replace(/"/g, '') }}</option>
        <option value="__custom__">自定义…</option>
      </select>
      <input
        v-if="!FONT_OPTIONS.includes(fontFamily)"
        :value="fontFamily"
        placeholder="CSS font-family 值,如 Menlo, monospace"
        style="margin-top: 8px"
        @input="emit('update:fontFamily', ($event.target as HTMLInputElement).value)"
      />

      <label>行高:{{ lineHeight.toFixed(1) }}</label>
      <input
        type="range"
        min="1"
        max="1.8"
        step="0.1"
        :value="lineHeight"
        @input="emit('update:lineHeight', Number(($event.target as HTMLInputElement).value))"
      />

      <label>光标样式</label>
      <select
        :value="cursorStyle"
        @change="emit('update:cursorStyle', ($event.target as HTMLSelectElement).value as 'block' | 'underline' | 'bar')"
      >
        <option value="block">块状</option>
        <option value="underline">下划线</option>
        <option value="bar">竖线</option>
      </select>

      <label class="checkbox-row">
        <input
          type="checkbox"
          :checked="cursorBlink"
          @change="emit('update:cursorBlink', ($event.target as HTMLInputElement).checked)"
        />
        光标闪烁
      </label>

      <div class="actions">
        <button class="btn ghost" @click="emit('reset')">恢复默认</button>
        <button class="btn" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 380px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px;
}
h3 {
  margin: 0 0 6px;
}
.sub {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin: 14px 0 6px;
}
label:first-of-type {
  margin-top: 0;
}
input[type='range'] {
  width: 100%;
  padding: 0;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.checkbox-row input {
  width: auto;
}
.actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 22px;
}
</style>
