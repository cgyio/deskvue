<script setup lang="ts">
/**
 * DvUacKernelService 用户权限系统服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 */
import { ref, computed } from 'vue'
import type { DvFsProgramMeta } from '../../../fs'
import { useDvProgramHook } from '../../../utils'

defineOptions({
    name: 'DvUacKernelService',
    programMeta: {
        name: 'DvUacKernelService',
        title: '用户服务',
        desc: 'Deskvue 系统的用户权限服务',
        isService: true,
        mimes: ['*.ss', '*.prof'],
    } as DvFsProgramMeta,
})
</script>
<template></template>
