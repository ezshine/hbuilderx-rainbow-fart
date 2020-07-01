/*
编程伴侣（HBuilderX插件）
版本：0.1.0
作者：ezshine

此插件的创意来源是VSCode的彩虹屁插件(感谢感谢)，兼容彩虹屁插件的语音包。
在本插件中，播放音频采用系统自带的命令，无需打开浏览器。
未来希望扩展为不仅仅只有彩虹屁功能，而是一个真正的编程伴侣。
*/

const hx = require("hbuilderx");

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

//监听HBuilder Node进程的退出事件，退出时通知live2dPlayer
const process = require('process');
process.on('exit', (code) => {
	client.shout('hbuilderExit');
});

let input_analysis;
let coding_start;
//该方法将在插件激活的时候调用
function activate(context) {
	console.log("好戏开始了：" + Date.now());
	console.log("当前系统为" + os.type);
	
	//初始化命中历史
	coding_start=Date.now();
	input_analysis={};
	
	//注册命令
	setupCommands();

	//获得插件配置
	const pluginConfig = hx.workspace.getConfiguration("codinglover");

	//根据当前系统是window还是macos选择默认的音频播放器
	const mp3Player = (os.type == "Darwin" ? "afplay" : path.join(__dirname, "players","mp3player.exe"));

	//是否禁用虚拟老婆
	const disableLive2d = pluginConfig.get("codinglover.disableLive2d",false);
	//虚拟老婆名称
	const live2dPackageName = pluginConfig.get("live2dPackageName", "liang") || "liang";
	const lpPath=path.join(__dirname, "live2dpackages", live2dPackageName);
	server.on('wifeLoaded', function(m, data){
		console.log("老婆起床啦："+lpPath);
		client.shout('initModel', {model: lpPath+"/model.json"});
	});
	//唤醒老婆容器
	const live2dPlayer=path.join(__dirname, "players","live2dplayer."+(os.type == "Darwin" ? "app" : "exe"));
	if(!disableLive2d){
		if (fs.existsSync(live2dPlayer)) {
			let cmd=(os.type == "Darwin" ? "open" : "start")+" "+live2dPlayer;
			console.log("执行唤醒老婆的命令："+cmd);
			exec(cmd);
		}else{
			showInformation('没有找到老婆容器：' + live2dPlayer);
		}
	}

	//是否禁用彩虹屁
	const disabledRainbowFart = pluginConfig.get("disabledRainbowFart",false);
	//输入监测时间间隔
	const inputDetectInterval = pluginConfig.get("inputDetectInterval", 5000) || 5000;
	//语音包名称
	const voicePackageName = pluginConfig.get("voicePackageName", "default") || "default";
	//语音包路径
	const vpPath = path.join(__dirname, "voicepackages", voicePackageName);

	//校验语音包
	if (!fs.existsSync(vpPath)) {
		showInformation('没有找到语音包：' + voicePackageName);
		return;
	}
	if (!fs.existsSync(path.join(vpPath, "contributes.json"))) {
		showInformation('没有找到语音包配置文件(contributes.json)');
		return;
	};
	setStatusMsg('已启用语音包' + voicePackageName);

	//语音包信息
	// const vpInfo = JSON.parse(fs.readFileSync(vpPath + "manifest.json"));
	//语音包配置表
	const vpContributes = JSON.parse(fs.readFileSync(path.join(vpPath, "contributes.json"))).contributes;
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
		hitkeyword: for (let i = vpContributes.length - 1; i >= 0; i--) {
			const item = vpContributes[i];
			const keywords = item.keywords;
			for (let j = keywords.length - 1; j >= 0; j--) {
				if (str.indexOf(keywords[j]) >= 0) {
					const keyword=keywords[j];
					voice_mark = keyword;
					voices = item.voices;
					break hitkeyword;
				}
			}
		}

		//命中以及和上次命中结果不一样时才播放，加入彩虹屁开关
		if (voices.length != 0 && last_voice_mark != voice_mark) {
			addInputAnalysis(voice_mark,now);
			if(!disabledRainbowFart){
				console.log("播放音频：" + voice_mark);
				showFace("");
				last_voice_mark = voice_mark;
				
				//音频播放器命令路径，将空格转义
				let playerpath=mp3Player.replace(/ /g, '\\ ');
				let audiopath=path.join(vpPath, voices[Math.floor(Math.random() * voices.length)]);
				audiopath=audiopath.replace(/ /g, '\\ ');
				
				const cmd = mp3Player + " " + audiopath;
				console.log(cmd);
				exec(cmd);
			}
		}
	}
}
//统一通知
function showInformation(msg) {
	hx.window.showInformationMessage('<span style="color:#3366ff">编程伴侣</span><br>' + msg);
}

function showFace(facename){
	// client.shout('a message came', {some: "123"});
	// hx.window.showWarningMessage('<img src="'+__dirname+'/facepackages/default/9wnQ-hkahyhx9261954.gif" style="width:100px;height:100px;"/>');
}

function setStatusMsg(msg, autohide = 2000) {
	hx.window.setStatusBarMessage('<span style="color:#3366ff">编程伴侣：</span>' + msg);
}

function setupCommands(){
	
	let disposable = hx.commands.registerTextEditorCommand('extension.showCodingAnalysis',(editor)=>{
		let report_str="编程时长 "+(Date.now()-coding_start)/1000+"秒 <br>";
		for(let item in input_analysis){
			report_str+=item+" 总计："+input_analysis[item].times+"<br>";
		}
		showInformation(report_str);
	});
}

function addInputAnalysis(keyword,time){
	if(input_analysis[keyword]){
		input_analysis[keyword].times+=1;
	}else{
		input_analysis[keyword]={
			times:1
		};
	}
}

//该方法将在插件禁用的时候调用（目前是在插件卸载的时候触发）
function deactivate() {
	
}
module.exports = {
	activate,
	deactivate
}
