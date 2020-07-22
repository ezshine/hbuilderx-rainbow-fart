/*
编程伴侣（HBuilderX插件）
作者：ezshine

此插件的创意来源是VSCode的彩虹屁插件(感谢感谢)，兼容彩虹屁插件的语音包。
在本插件中，播放音频采用系统自带的命令，无需打开浏览器。
未来希望扩展为不仅仅只有彩虹屁功能，而是一个真正的编程伴侣。
*/

const hx = require("hbuilderx");
const http = require('http');
const unzip = require("unzip");

const {
	exec
} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

//用于和live2dPlayer进程通讯的信使
const messenger = require('messenger');
const server = messenger.createListener(32719);
const client = messenger.createSpeaker(32718);

const pluginName = "编程伴侣";

//监听HBuilder Node进程的退出事件，退出时通知live2dPlayer
const process = require('process');
process.on('exit', (code) => {
	client.shout('hbuilderExit');
});

let ostype;
let resources_dir;

let input_analysis;
let coding_start;
let pluginConfig;
let versions;
//虚拟老婆相关配参
let enabledLive2d;
let live2dPackageName;
let wifeIsReady = false;
let live2dPlayer;
let lpPath;
let lpModelData;
//彩虹屁相关配参
let enabledRainbowFart;
let inputDetectInterval;
let voicePackageName;
let vpPath;
let vpContributes
//调试相关配参
let outputChannel;
let enabledDebug;
//该方法将在插件激活的时候调用
async function activate(context) {
	//获得插件配置
	pluginConfig = hx.workspace.getConfiguration("codinglover");
	//是否开启调试模式
	enabledDebug = pluginConfig.get("enabledDebug", false);
	// enabledDebug=true;
	openDebugChannel();

	debugLog("好戏开始了：" + Date.now());
	ostype = os.type;
	debugLog("当前系统为" + ostype);
	
	resources_dir = path.posix.join(hx.env.appData, "ezshine-codinglover");
	if (!fs.existsSync(resources_dir)) {
		setStatusMsg("插件资源初始化...");
		await extractZipFile(path.posix.join(__dirname, "resources.zip"), resources_dir).then(() => {
			setStatusMsg("初始化成功");
		});
	}

	//初始化命中历史
	coding_start = Date.now();
	input_analysis = {};

	//注册命令
	setupCommands();
	//监听插件配置更改行为
	watchconfigurationChange();

	//是否开启虚拟老婆
	enabledLive2d = pluginConfig.get("enabledLive2d", false);
	//虚拟老婆名称
	live2dPackageName = pluginConfig.get("live2dPackageName", "sharonring") || "sharonring";

	//是否禁用彩虹屁
	enabledRainbowFart = pluginConfig.get("enabledRainbowFart", false);
	//输入监测时间间隔
	setInputDetectInterval();

	//语音包名称
	voicePackageName = pluginConfig.get("voicePackageName", "sharonring") || "sharonring";
	//检查插件配置
	debugLog("resourcesDirPath：" + resources_dir);
	debugLog("enabledDebug：" + enabledDebug);
	debugLog("enabledLive2d：" + enabledLive2d);
	debugLog("live2dPackageName：" + live2dPackageName);
	debugLog("enabledRainbowFart：" + enabledRainbowFart);
	debugLog("inputDetectInterval：" + inputDetectInterval);
	debugLog("voicePackageName：" + voicePackageName);

	//老婆数据路径
	lpPath = path.posix.join(resources_dir, "live2dpackages", live2dPackageName);

	let accordCall = setTimeout(() => {
		client.shout("changeModel", {
			model: path.posix.join(lpPath, "model.json")
		});
	}, 1000);

	server.on('wifeContainerReady', function(m, data) {
		clearTimeout(accordCall);
		debugLog("老婆容器已就绪，容器版本：" + data.v);

		if (!fs.existsSync(path.posix.join(lpPath, "model.json"))) {
			debugLog("老婆数据包错误：" + path.posix.join(lpPath, "model.json"));
			return;
		}

		debugLog("通知容器加载老婆数据：" + lpPath);
		wifeIsReady = true;
		client.shout('loadModel', {
			model: path.posix.join(lpPath, "model.json"),
			commands: [{
					motionfile: "mtn/aoba_live2D_24.mtn",
					text: "是不是遇到麻烦了？",
					voice: path.posix.join(vpPath, "console_2.mp3")
				},
				{
					motionfile: "mtn/aoba_live2D_28.mtn",
					text: "别着急，冷静下，困难一定能解决的",
					voice: path.posix.join(vpPath, "console_3.mp3")
				},
				{
					motionfile: "mtn/aoba_live2D_08.mtn",
					text: "现在开始执行B计划",
					voice: path.posix.join(vpPath, "except_1.mp3")
				},
				{
					motionfile: "mtn/aoba_live2D_23.mtn",
					text: "愿梦里没有bug",
					voice: path.posix.join(vpPath, "time_midnight_1.mp3")
				},
				{
					motionfile: "mtn/aoba_live2D_32.mtn",
					text: "你累不累呀？要不休息一下吧",
					voice: path.posix.join(vpPath, "time_each_hour_2.mp3")
				}
			],
			sendlog: enabledDebug
		});

		lpModelData = JSON.parse(fs.readFileSync(path.posix.join(lpPath, "model.json")));

		server.on("wifeContainerLog", function(m, data) {
			debugLog("来自老婆容器：" + ((typeof data == "object") ? JSON.stringify(data) : data));
		});

		checkUpdate("live2dplayer", data.v, function(need) {
			if (need) {
				debugLog("老婆容器有新版本：" + versions.live2dplayer);
				let btns = ["立即更新", "暂不更新"];
				let download_pan = showInformation("老婆容器有更新：" + versions.live2dplayer, "", btns);
				download_pan.then((result) => {
					if (result == "立即更新") {
						client.shout('hbuilderExit');
						downloadWifeContainer();
					}
				});
			}
		});
	});
	//老婆容器路径
	live2dPlayer = path.posix.join(resources_dir, "players", "live2dplayer." + (ostype == "Darwin" ? "app" : "exe"));

	//启用老婆
	openWifeContainer();

	//根据当前系统是window还是macos选择默认的音频播放器
	const mp3Player = (ostype == "Darwin" ? "afplay" : path.posix.join(resources_dir, "players", "mp3player.exe"));

	//配置语音包
	setupVoicePackage();

	//时间标记名称，用于计算每一个时间标记提醒仅提醒一次
	let voice_mark = "";
	let last_voice_mark = "";
	//上次时间提醒，每隔半小时检查一次时间提醒
	let time_alarm = 0;
	//上次查询的时间戳，用户计算间隔
	let pre = 0;
	//当编辑器中正在输入的时候
	const onDidChangeTextDocumentEventDispose = hx.workspace.onDidChangeTextDocument(function(event) {
		const activeEditor = hx.window.getActiveTextEditor();
		activeEditor.then(function(editor) {
			const linePromise = editor.document.lineFromPosition(editor.selection.active);
			linePromise.then((line) => {
				//当行字符超过50时不做处理
				if (line.length > 50) return;
				parseLine(line.text.trim());
			});
		});
	});

	//重头戏在这里，解析当前行内容并作出相应的反应
	//todo 优化查询性能
	function parseLine(str) {
		const now = new Date();
		if (now - pre < inputDetectInterval) {
			//当两次解析间隔小于输入监测间隔时取消本次处理
			return;
		}
		//重设时间间隔起点
		pre = now;

		//优先时间提醒
		//当上一次的提示不是时间提醒，并且距离上次提醒超过30分钟时才执行时间判断
		if (voice_mark.indexOf("$") < 0 && now - time_alarm > 1800000) {
			time_alarm = now.getTime();
			const hour = now.getHours();
			const minute = now.getMinutes();
			if (minute == 0 && voice_mark != "$time_each_hour") {
				voice_mark = str = "$time_each_hour";
			} else if (hour > 6 && hour <= 9 && voice_mark != "$time_morning") {
				voice_mark = str = "$time_morning";
			} else if (hour >= 11 && hour <= 12 && minute > 30 && voice_mark != "$time_before_noon") {
				voice_mark = str = "$time_before_noon";
			} else if (hour >= 13 && hour <= 15 && voice_mark != "$time_noon") {
				voice_mark = str = "$time_noon";
			} else if (hour >= 20 && hour <= 21 && voice_mark != "$time_evening") {
				voice_mark = str = "$time_evening";
			} else if (hour >= 23 || hour <= 4) {
				voice_mark = str = "$time_midnight";
			}
		}

		let voices = [];
		let hited_item;
		hitkeyword: for (let i = vpContributes.length - 1; i >= 0; i--) {
			const item = vpContributes[i];
			const keywords = item.keywords;
			for (let j = keywords.length - 1; j >= 0; j--) {
				if (str.indexOf(keywords[j]) >= 0) {
					hited_item = item;
					const keyword = keywords[j];
					voice_mark = keyword;
					voices = item.voices;
					break hitkeyword;
				}
			}
		}

		let motions;
		if (wifeIsReady && lpModelData.contributes) {
			hitkeyword: for (let i = lpModelData.contributes.length - 1; i >= 0; i--) {
				const item = lpModelData.contributes[i];
				const keywords = item.keywords;
				for (let j = keywords.length - 1; j >= 0; j--) {
					if (voice_mark == keywords[j]) {
						motions = item.motions;
						break hitkeyword;
					}
				}
			}
		}

		//命中以及和上次命中结果不一样时才播放，加入彩虹屁开关
		if (voices.length != 0 && last_voice_mark != voice_mark) {
			debugLog("命中关键词：" + voice_mark);

			//暂且禁用这个没卵用的功能
			//addInputAnalysis(voice_mark, now);

			let voice_index = Math.floor(Math.random() * voices.length);
			if (enabledRainbowFart) {
				debugLog("即将播放音频：");
				last_voice_mark = voice_mark;

				//音频播放器命令路径，将空格转义
				let playerpath = mp3Player;
				let audiopath = path.posix.join(vpPath, voices[voice_index]);

				const cmd = '"' + playerpath + '" "' + audiopath + '"';
				debugLog(cmd);
				exec(cmd);
			} else {
				debugLog("彩虹屁语音未启用");
			}

			if (wifeIsReady) {
				//如果老婆容器已就绪，则准备切换老婆动画
				let motionfile;
				if (motions) {
					motionfile = motions[Math.floor(Math.random() * motions.length)];
				}
				showWifeMotion(motionfile);

				//检查彩虹屁是否有台词文本，如果有则显示
				if (hited_item.texts) {
					let text = hited_item.texts[voice_index];
					showWifeTextBubble(text);
				}
			}
		}
	}
}

//检查版本更新
function needUpdate(currVer, promoteVer) {
	currVer = currVer ? currVer.replace(/[vV]/, "") : "0.0.0";
	promoteVer = promoteVer ? promoteVer.replace(/[vV]/, "") : "0.0.0";
	if (currVer == promoteVer) return false;
	var currVerArr = currVer.split(".");
	var promoteVerArr = promoteVer.split(".");
	var len = Math.max(currVerArr.length, promoteVerArr.length);
	for (var i = 0; i < len; i++) {
		var proVal = ~~promoteVerArr[i],
			curVal = ~~currVerArr[i];
		if (proVal > curVal) {
			return true;
		}
	}
	return false;
};
async function checkUpdate(type, vn, callbacks) {
	if (!versions) {
		debugLog("从服务端获取...");
		versions = await doGet("http://rfw.jnsii.com/api/checkupdate.php");
	}
	debugLog("最新版本信息：");
	debugLog(versions);

	if (callbacks) callbacks(needUpdate(vn, versions[type]));
}

//http request
function doGet(url) {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			if (res.statusCode !== 200) {
				debugLog("请求失败");
				reject();
				return;
			}

			let rawData = '';
			res.on('data', (chunk) => {
				rawData += chunk;
			});
			res.on('end', () => {
				try {
					let parsedData = JSON.parse(rawData);
					resolve(parsedData);
				} catch (e) {
					debugLog(e.message);
					reject(e);
				}
			});
		});
	});
}

//
function setInputDetectInterval() {
	let inputDetectIntervalName = pluginConfig.get("inputDetectIntervalName", "及时") || "及时";
	if (inputDetectIntervalName == "瞬时") inputDetectInterval = 800;
	else if (inputDetectIntervalName == "及时") inputDetectInterval = 2000;
	else inputDetectInterval = 5000;
}

//监听当插件配置更改时做出反应
function watchconfigurationChange() {
	let configurationChangeDisplose = hx.workspace.onDidChangeConfiguration(function(event) {
		if (event.affectsConfiguration("codinglover.enabledDebug")) {
			enabledDebug = pluginConfig.get("enabledDebug", false);
			openDebugChannel();
			debugLog("enabledDebug：" + enabledDebug);
		} else if (event.affectsConfiguration("codinglover.enabledLive2d")) {
			enabledLive2d = pluginConfig.get("enabledLive2d", false);
			debugLog("enabledLive2d：" + enabledLive2d);
			openWifeContainer();
		} else if (event.affectsConfiguration("codinglover.live2dPackageName")) {
			if (pluginConfig.get("live2dPackageName", "liang") != live2dPackageName) {
				live2dPackageName = pluginConfig.get("live2dPackageName", "liang");
				debugLog("live2dPackageName：" + live2dPackageName);
				lpPath = path.posix.join(resources_dir, "live2dpackages", live2dPackageName);
				if (wifeIsReady) {
					debugLog("通知老婆容器加载数据：" + lpPath);
				} else {
					return debugLog("老婆容器未就绪");
				}
				client.shout("changeModel", {
					model: path.posix.join(lpPath, "model.json")
				});
			}
		} else if (event.affectsConfiguration("codinglover.enabledRainbowFart")) {
			enabledRainbowFart = pluginConfig.get("enabledRainbowFart", false);
			debugLog("enabledRainbowFart：" + enabledRainbowFart);
		} else if (event.affectsConfiguration("codinglover.inputDetectIntervalName")) {
			setInputDetectInterval();
			debugLog("inputDetectInterval：" + inputDetectInterval);
		} else if (event.affectsConfiguration("codinglover.voicePackageName")) {
			if (pluginConfig.get("voicePackageName", "sharonring") != voicePackageName) {
				voicePackageName = pluginConfig.get("voicePackageName", "sharonring");
				setupVoicePackage();
			}
		} else if (event.affectsConfiguration("codinglover.resourcesDirPath")) {
			if (pluginConfig.get("resourcesDirPath") != resources_dir) {
				showInformation("资源目录已更改，请重启HBuilderX");
			}
		}
	});
}

//统一调试
function openDebugChannel() {
	if (enabledDebug) {
		outputChannel = hx.window.createOutputChannel(pluginName);
		outputChannel.show();
	}
}

function debugLog(str) {
	if (enabledDebug) {
		outputChannel.appendLine((typeof str == "object") ? JSON.stringify(str) : str);
	} else {
		console.log(str);
	}
}

//通用解压缩
function extractZipFile(filepath, destpath) {
	return new Promise((resolve, reject) => {
		var extract = unzip.Extract({
			path: destpath
		});
		extract.on('finish', function() {
			resolve();
		});
		extract.on('error', function(err) {
			debugLog(err);
			reject();
		});
		fs.createReadStream(filepath).pipe(extract);
	});
}
//下载老婆容器
function downloadWifeContainer() {
	setStatusMsg("开始下载老婆容器");
	debugLog("开始下载老婆容器");

	let file_name = (ostype == "Darwin" ? "mac" : "win") + ".zip";
	let file_dest = path.posix.join(resources_dir, "players", file_name);

	if (fs.existsSync(file_dest)) fs.unlinkSync(file_dest);

	downloadFile("http://rfw.jnsii.com/downloads/" + file_name, file_dest, {
		success: () => {
			setStatusMsg("老婆容器已下载");
			if (ostype == "Darwin") {
				let download_pan = showInformation("下载已完成，您的系统无法自动解压缩，请手动解压后双击live2dplayer启动", "", [
					"手动解压"
				]);
				download_pan.then((result) => {
					let openpath = path.posix.join("file:", resources_dir, "players");
					console.log("打开文件夹：", openpath);
					hx.env.openExternal(openpath);
				});
			} else {
				setStatusMsg("正在解压缩...");
				extractZipFile(file_dest, path.posix.join(resources_dir, "players")).then(() => {
					setStatusMsg("正在启动彩虹屁老婆");
					openWifeContainer();
				});
			}
		},
		progress: (bytesloaded, bytestotal) => {
			setStatusMsg("老婆容器下载进度：" + (bytesloaded / bytestotal * 100).toFixed(2) + "%");
		}
	});
}
//手动安装提示
function openQQGroupTips() {
	let qun_pan = showInformation("加入QQ群:1059850921，可在群里交流、求助、下载更多二次元老婆模型。", "", [
		"加入QQ群",
		"先不加"
	]);
	qun_pan.then((result) => {
		if (result == "加入QQ群") hx.env.openExternal(
			"http://shang.qq.com/wpa/qunwpa?idkey=d5a082a270d591e1364a5107f408086ba4ced20da4597d1fa12486f989d7341a");
	});
}
//启动老婆容器
function openWifeContainer() {
	if (enabledLive2d) {
		//如果老婆容器存在
		if (fs.existsSync(live2dPlayer)) {
			let cmd = (ostype == 'Darwin' ? 'open ' : 'start "" ') + '"' + live2dPlayer + '"';
			debugLog("执行唤醒老婆容器的命令：" + cmd);
			exec(cmd);
		} else {
			let download_pan = showInformation("需要下载老婆容器，请保持下载过程中网络的通畅哟。", "", ["立即下载"]);
			download_pan.then((result) => {
				if (result == "立即下载") {
					downloadWifeContainer();
				}
			})
		}
	} else {
		if (wifeIsReady) {
			client.shout('hbuilderExit');
			wifeIsReady = false;
		}
	}
}
//配置语音包
function setupVoicePackage() {
	//语音包路径
	vpPath = path.posix.join(resources_dir, "voicepackages", voicePackageName);

	//校验语音包
	if (!fs.existsSync(vpPath)) {
		showInformation('没有找到语音包：' + voicePackageName);
	} else if (!fs.existsSync(path.posix.join(vpPath, "contributes.json"))) {
		showInformation('没有找到语音包配置文件(contributes.json)');
	} else {
		debugLog('已启用语音包' + voicePackageName);
	}

	//语音包配置表
	vpContributes = JSON.parse(fs.readFileSync(path.posix.join(vpPath, "contributes.json"))).contributes;
	debugLog(vpContributes);
}

//统一通知
function showInformation(msg, title, buttons = []) {
	if (!title) title = pluginName;
	var str = '<span style="color:#3366ff">' + title + '</span><br>' + msg + '<br>';
	return hx.window.showInformationMessage(str, buttons);
}

function showWifeMotion(motionfile) {
	debugLog("切换老婆的动作：" + (motionfile ? motionfile : "随机"));
	client.shout('changeMotion', {
		motionfile: motionfile
	}); //motionfile
}

function showWifeTextBubble(str) {
	debugLog("让老婆显示文字：" + str);
	client.shout('showBubble', {
		content: str
	});
}

function setStatusMsg(msg, autohide = 2000) {
	hx.window.setStatusBarMessage('<span style="color:#3366ff">' + pluginName + '：</span>' + msg);
}

function setupCommands() {

	let cmd_res1 = hx.commands.registerTextEditorCommand('extension.showCodingAnalysis', (editor) => {
		let report_str = "编程时长 " + (Date.now() - coding_start) / 1000 + "秒 <br>";
		for (let item in input_analysis) {
			report_str += item + " 总计：" + input_analysis[item].times + "<br>";
		}
		showInformation(report_str);
	});

	let cmd_res2 = hx.commands.registerTextEditorCommand('extension.codingloverEnabledLP', (editor) => {
		pluginConfig.update("enabledLive2d", !enabledLive2d);
	});

	let cmd_res3 = hx.commands.registerTextEditorCommand('extension.codingloverEnabledVP', (editor) => {
		pluginConfig.update("enabledRainbowFart", !enabledRainbowFart);
	});

	let cmd_res4 = hx.commands.registerTextEditorCommand('extension.codingloverPickVP', (editor) => {
		var vpDir = path.posix.join(resources_dir, "voicepackages");
		var res = [],
			files = fs.readdirSync(vpDir);
		files.forEach(function(filename) {
			var filepath = path.posix.join(vpDir, filename),
				stat = fs.lstatSync(filepath);

			if (stat.isDirectory()) {
				res.push({
					label: filename,
					description: (filename == voicePackageName ? "使用中" : "")
				});
			}
		});

		const pickResult = hx.window.showQuickPick(res, {
			placeHolder: pluginName + '：切换彩虹屁语音包'
		});
		pickResult.then(function(result) {
			if (!result) {
				return;
			}
			if (result.description == "") {
				pluginConfig.update("voicePackageName", result.label);
			}
		});
	});

	let cmd_res5 = hx.commands.registerTextEditorCommand('extension.codingloverPickLP', (editor) => {
		var lpDir = path.posix.join(resources_dir, "live2dpackages");
		var res = [],
			files = fs.readdirSync(lpDir);
		files.forEach(function(filename) {
			var filepath = path.posix.join(lpDir, filename),
				stat = fs.lstatSync(filepath);

			if (stat.isDirectory()) {
				res.push({
					label: filename,
					description: (filename == live2dPackageName ? "使用中" : "")
				});
			}
		});

		const pickResult = hx.window.showQuickPick(res, {
			placeHolder: pluginName + '：切换彩虹屁老婆'
		});
		pickResult.then(function(result) {
			if (!result) {
				return;
			}
			if (result.description == "") {
				pluginConfig.update("live2dPackageName", result.label);
			}
		});
	});

	let cmd_res6 = hx.commands.registerTextEditorCommand('extension.codingloverDownloadLP', (editor) => {
		openQQGroupTips();
	});

	let cmd_res7 = hx.commands.registerTextEditorCommand('extension.codingloverEnabledDebug', (editor) => {
		pluginConfig.update("enabledDebug", !enabledDebug);
	});

	let cmd_res8 = hx.commands.registerTextEditorCommand('extension.codingloverGoRateStar', (editor) => {
		hx.env.openExternal("https://ext.dcloud.net.cn/plugin?id=2157");
	});

	let cmd_res9 = hx.commands.registerTextEditorCommand("extension.codingloverOpenResourcesDir", (editor) => {
		let openpath = path.posix.join("file:", resources_dir);
		console.log("打开文件夹：", openpath);
		hx.env.openExternal(openpath);
	});

	let cmd_res10 = hx.commands.registerTextEditorCommand("extension.codingloverDelResourcesDir", (editor) => {
		if (wifeIsReady) {
			let delete_pan = showInformation("删除已存储数据前请先关闭彩虹屁老婆容器", '', ["立即关闭"]);
			delete_pan.then((result) => {
				if (result == "立即关闭") {
					client.shout('hbuilderExit');
					askDeleteResourcesDir();
				}
			})
		} else {
			askDeleteResourcesDir();
		}
	});
}

function askDeleteResourcesDir() {
	let delete_pan = showInformation("确定要删除已存储数据吗？已经保存的语音包，老婆模型都将被彻底删除，并无法恢复！！!",
		'<span style="color:#ff3366">★★★请注意★★★</span>', ["确定删除", "怕怕~点错了"]);
	delete_pan.then((result) => {
		if (result == "确定删除") {
			let cmd = (ostype == "Darwin" ? 'rm -rf' : 'rmdir /s/q');
			exec(cmd + ' "' + resources_dir + '"');
			showInformation("删除成功，请重启HBuilderX");
		}
	})
}

function addInputAnalysis(keyword, time) {
	if (input_analysis[keyword]) {
		input_analysis[keyword].times += 1;
	} else {
		input_analysis[keyword] = {
			times: 1
		};
	}
}

function downloadFile(url, dest, callbacks) {
	if (!callbacks) callbacks = {};

	if (fs.existsSync(dest)) {
		debugLog(dest + "已存在");
		if (callbacks.success) callbacks.success();
		return;
	}

	debugLog("准备将" + url + "下载至" + dest);
	const file = fs.createWriteStream(dest);

	http.get(url, (res) => {
		if (res.statusCode !== 200) {
			if (callbacks.fail) callbacks.fail(res);
			return;
		}

		const bytestotal = parseInt(res.headers['content-length'], 10);
		let bytesloaded = 0;
		debugLog("文件大小：" + bytestotal);

		res.on('end', () => {
			if (callbacks.success) callbacks.success();
		});
		res.on('data', (data) => {
			const data_len = parseInt(data.length, 10);
			bytesloaded += data_len;
			debugLog("已下载大小：" + bytesloaded);
			if (callbacks.progress) callbacks.progress(bytesloaded, bytestotal);
		});

		file.on('finish', () => {
			file.close();
		}).on('error', (err) => {
			fs.unlink(dest);
		});

		res.pipe(file);
	});
}

//该方法将在插件禁用的时候调用（目前是在插件卸载的时候触发）
function deactivate() {

}
module.exports = {
	activate,
	deactivate
}
