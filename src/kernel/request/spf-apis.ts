/**
 * 后端 apis 接口适配
 * !! 必须导出这些内容：
 *  0   apis: Record<string, DvApiDefine>
 *  1   errorCodes: Record<string, (string|number)[]>
 *
 * 适配 Spf 框架的 apis 接口定义
 *
 */

export const spfApis = {
    //Deskvue update 接口
    dvUpdate: {
        api: '/api/deskvue/update/:api',
        name: 'Deskvue 自动更新接口',
        param: {},
        return: {},
        noCache: true,
    },
    //Deskvue remoteConfig 接口
    dvRemoteConfig: {
        api: '/api/deskvue/config/:api',
        name: 'Deskvue 远程配置接口',
        param: {},
        return: {
            hash: '',
        },
        noCache: true,
    },

    //uac 接口
    uacLogin: {
        api: '/uac/api/login',
        name: '登录接口',
        param: {
            iso: '',
            name: '',
            pswd: '',
            vcode: '',
        },
        return: {
            token: '',
            uuid: '',
        },
        noCache: true,
    },
    uacLogout: {
        api: '/uac/api/logout',
        name: '登出接口',
        param: {
            uuid: '',
        },
        return: {
            success: true,
        },
        noCache: true,
    },
    uacAccount: {
        api: '/uac/api/account',
        name: '账号信息接口',
        param: {
            uuid: '',
        },
        return: {
            id: '',
            uuid: '',
            openid: '',
            name: '',
            role_list: [''],
            auth_list: [''],
            iso_list: [''],
        },
        noCache: false,
    },
    uacAuthCheck: {
        api: '/uac/api/auth_check',
        name: '权鉴接口',
        param: {
            uuid: '',
            auths: [''],
        },
        return: {
            grant: true,
            msg: '',
        },
        noCache: true,
    },
    //!! 心跳接口
    heartBeat: {
        api: '/api/heartbeat',
        name: '心跳接口',
        param: {},
        return: {
            timestamp: 0,
            timestr: '',
        },
        noCache: true,
    },
    //!! Task 长耗时接口测试
    testTaskCreate: {
        api: '/api/test_task/create',
        name: 'Task 创建接口',
        param: {},
        return: {
            id: '',
            title: '',
            status: '',
            stepTo: -1,
            timestamp: {
                start: 0,
                end: 0,
            },
            step: [],
        },
    },
    testTaskNext: {
        api: '/api/test_task/next',
        name: 'Task 执行接口',
        param: {
            taskId: '',
        },
        return: {
            id: '',
            title: '',
            status: '',
            stepTo: -1,
            timestamp: {
                start: 0,
                end: 0,
            },
            step: [],
        },
    },

    //db 接口，对接 SPF-Orm 后端系统的标准化数据库操作接口
    dbAvailable: {
        api: '/orm/api/available',
        name: '获取全部可用数据模型接口',
        param: {},
        return: {},
        noCache: false,
    },
    dbConfig: {
        api: '/orm/api/front_db_config/deskvue/:dbn',
        name: '数据库结构化配置参数接口',
        param: {},
        return: {
            meta: {
                name: '',
                title: '',
                desc: '',
            },
            frontend: '',
            models: [],
            model: {},
        },
        noCache: false,
    },
    dbOptions: {
        api: '/orm/api/select_options',
        name: '获取数据库所有可用下拉列表选项',
        param: {},
        return: {},
        noCache: false,
    },
    //curd
    dbCreate: {
        api: '/db/:dbn/:model/create',
        name: '记录创建接口',
        param: {
            data: {},
        },
        return: {},
        noCache: false,
    },
    dbUpdate: {
        api: '/db/:dbn/:model/update',
        name: '记录编辑接口',
        param: {
            query: {},
            data: {},
        },
        return: {},
        noCache: false,
    },
    dbRetrieve: {
        api: '/db/:dbn/:model/retrieve',
        name: '记录查询接口',
        param: {
            query: {},
        },
        return: {
            result: [],
            query: {},
            page: {},
        },
        noCache: false,
    },
    dbDelete: {
        api: '/db/:dbn/:model/delete',
        name: '记录删除接口',
        param: {
            query: {},
        },
        return: {},
        noCache: false,
    },
    //任意模型接口
    dbModelApi: {
        api: '/db/:dbn/:model/:api',
        name: '数据模型业务接口',
        param: {},
        return: {},
        noCache: false,
    },
}

//Spf 框架接口错误码
export const spfErrorCodes = {
    //需要终止后续
    abortCodes: [
        '0310018', //token 被篡改
        '0310019', //token 与访问来源不一致，被冒用
    ],

    //未登录
    notLoginCodes: [
        '0310015', //用户已经手动登出
        '0310016', //用户还未登录
        '0310017', //token 已过期
    ],

    //登录过程中的错误，需要静默处理
    inLoginCodes: [
        '0310021', //错误的用户名密码，不存在的用户名，登录次数过多
    ],
}
