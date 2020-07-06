import React, { Component } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Button,
  Dimensions,
  StatusBar,
  Alert,
  Platform
} from 'react-native';
import ListView from 'deprecated-react-native-listview';
const { width, height } = Dimensions.get('window')
import io from 'socket.io-client';
import _ from 'lodash'
const socket = io.connect('http://192.168.1.7:5555', {transports: ['websocket']});

/*************** WebRTC Start ******************/

import {
  RTCPeerConnection,
  RTCMediaStream,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  mediaDevices,
  getUserMedia,
} from 'react-native-webrtc';

const configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

const pcPeers = {};
let localStream;

async function getLocalStream(isFront, callback) {

  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      googEchoCancellation: true,
      googAutoGainControl: true,
      googNoiseSuppression: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true,
      googNoiseReduction: true
    },
    video: {
      facingMode: 'user',
      frameRate: 30,
      height: 720,
      width: 1280
    }
  };
  const newStream = await mediaDevices.getUserMedia(constraints);
  callback(newStream);
}

function join(roomID) {
  socket.emit('join', roomID, function(socketIds){
    console.log('join', socketIds);
    for (const i in socketIds) {
      const socketId = socketIds[i];
      createPC(socketId, true);
    }
  });
}

function createPC(socketId, isOffer) {
  const pc = new RTCPeerConnection(configuration);
  pcPeers[socketId] = pc;

  pc.onicecandidate = function (event) {
    console.log('onicecandidate', event.candidate);
    if (event.candidate) {
      socket.emit('exchange', {'to': socketId, 'candidate': event.candidate });
    }
  };

  function createOffer() {
    pc.createOffer(function(desc) {
      console.log('createOffer', desc);
      pc.setLocalDescription(desc, function () {
        console.log('setLocalDescription', pc.localDescription);
        socket.emit('exchange', {'to': socketId, 'sdp': pc.localDescription });
      }, logError);
    }, logError);
  }

  pc.onnegotiationneeded = function () {
    console.log('onnegotiationneeded');
    if (isOffer) {
      createOffer();
    }
  }

  pc.oniceconnectionstatechange = function(event) {
    console.log('oniceconnectionstatechange', event.target.iceConnectionState);
    if (event.target.iceConnectionState === 'completed') {
      setTimeout(() => {
        getStats();
      }, 1000);
    }
    if (event.target.iceConnectionState === 'connected') {
      createDataChannel();
    }
  };
  pc.onsignalingstatechange = function(event) {
    console.log('onsignalingstatechange', event.target.signalingState);
  };

  pc.onaddstream = function (event) {
    console.log('onaddstream', event.stream);
    _this.setState({info: 'One peer join!'});

    const remoteList = _this.state.remoteList;
    remoteList[socketId] = event.stream.toURL();
    _this.setState({ remoteList: remoteList });
  };
  pc.onremovestream = function (event) {
    console.log('onremovestream', event.stream);
  };

  pc.addStream(localStream);
  function createDataChannel() {
    if (pc.textDataChannel) {
      return;
    }
    const dataChannel = pc.createDataChannel("text");

    dataChannel.onerror = function (error) {
      console.log("dataChannel.onerror", error);
    };

    dataChannel.onmessage = function (event) {
      console.log("dataChannel.onmessage:", event.data);
      _this.receiveTextData({user: socketId, message: event.data});
    };

    dataChannel.onopen = function () {
      console.log('dataChannel.onopen');
      _this.setState({textRoomConnected: true});
    };

    dataChannel.onclose = function () {
      console.log("dataChannel.onclose");
    };

    pc.textDataChannel = dataChannel;
  }
  return pc;
}

function exchange(data) {
  const fromId = data.from;
  let pc;
  if (fromId in pcPeers) {
    pc = pcPeers[fromId];
  } else {
    pc = createPC(fromId, false);
  }

  if (data.sdp) {
    console.log('exchange sdp', data);
    pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
      if (pc.remoteDescription.type == "offer")
        pc.createAnswer(function(desc) {
          console.log('createAnswer', desc);
          pc.setLocalDescription(desc, function () {
            console.log('setLocalDescription', pc.localDescription);
            socket.emit('exchange', {'to': fromId, 'sdp': pc.localDescription });
          }, logError);
        }, logError);
    }, logError);
  } else {
    console.log('exchange candidate', data);
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
}

function leave(socketId) {
  console.log('leave', socketId);
  const pc = pcPeers[socketId];
  const viewIndex = pc.viewIndex;
  pc.close();
  delete pcPeers[socketId];

  const remoteList = _this.state.remoteList;
  delete remoteList[socketId]
  _this.setState({ remoteList: remoteList });
  _this.setState({info: 'One peer leave!'});
}

socket.on('exchange', function(data){
  exchange(data);
});
socket.on('leave', function(socketId){
  leave(socketId);
});

socket.on('connect', function(data) {
  console.log('connect');
  getLocalStream(true, function(stream) {
    localStream = stream;
    _this.setState({selfViewSrc: stream.toURL()});
    _this.setState({status: 'ready', info: 'Please enter or create room ID'});
  });
});

function logError(error) {
  console.log("logError", error);
}

function mapHash(hash, func) {
  const array = [];
  for (const key in hash) {
    const obj = hash[key];
    array.push(func(obj, key));
  }
  return array;
}

function getStats() {
  const pc = pcPeers[Object.keys(pcPeers)[0]];
  if (pc.getRemoteStreams()[0] && pc.getRemoteStreams()[0].getAudioTracks()[0]) {
    const track = pc.getRemoteStreams()[0].getAudioTracks()[0];
    console.log('track', track);
    pc.getStats(track, function(report) {
      console.log('getStats report', report);
    }, logError);
  }
}

/*************** WebRTC End ******************/

let _this
let username
let busy = false
let incallwith = ""

function onLogin(data){
    if (data.success === false) {
       _this.setState({ message: "oops...try a different username" })
   } else {
       //var loginContainer = document.getElementById('loginContainer');
       //loginContainer.parentElement.removeChild(loginContainer);
       username = data.username;
       console.log("Login Successfull");
       console.log("logged in as :"+username);
       console.log(data.userlist);
       let toArray = _.keys(data.userlist);
       const ds = new ListView.DataSource({rowHasChanged: (r1, r2) => r1 !== r2});
       _this.setState({ currScreen: 'userList', dataSource: ds.cloneWithRows(toArray) })
    }
}
function callAccept(data){
  console.log("call accepted");
  const roomid = incallwith+"-"+username;
  join(roomid);
  socket.send({
       type: "call_accepted",
       callername: data.callername,
       from: username
      })
  _this.setState({ call_status: "on" })
}

function callReject(data){
    console.log("call rejected");
    socket.send({
           type: "call_rejected",
           callername: data.callername,
           from: username
    })
    busy = false
    incallwith = ""
}
function onAnswer(data){
        if(busy == false){
            busy = true
            incallwith = data.callername
            //var res = confirm(data.callername+" is calling you");
            Alert.alert(
              'Incoming Call',
              data.callername+" is calling you",
              [
                {text: 'Cancel', onPress: () => callReject(data), style: 'cancel'},
                {text: 'OK', onPress: () => callAccept(data) },
              ],
              { cancelable: false }
            )

             }else{
                 console.log("call busy");
                 //this.setState({ callResponse: "Call accepted by :"+ data.responsefrom })
                 socket.send({
                        type: "call_busy",
                        callername: data.callername,
                        from: username
                 })

             }
}
function onResponse(data){
                switch(data.response){
                    case "accepted":
                    incallwith = data.responsefrom;
                    //_this.setState({ callResponse: "Call accepted by "+ data.responsefrom })
                    console.log("Call accepted by :"+ data.responsefrom);
                    const roomid = username+"-"+data.responsefrom;
                		join(roomid)
                    _this.setState({ call_status: "on" });
                    break;
                    case "rejected":
                    _this.setState({ callResponse: "Call rejected by "+ data.responsefrom })
                    busy = false;
                    incallwith = ""
                    break;
                    case "busy":
                    _this.setState({ callResponse: data.responsefrom+" call busy" })
                    busy = false;
                    incallwith = ""
                    break;
                    default:
                    _this.setState({ callResponse: data.responsefrom+" is offline" })
                    busy = false;
                    incallwith = ""
                }

}
socket.on('roommessage', function(message){
            var data = message;
            let currUsers
            const ds = new ListView.DataSource({rowHasChanged: (r1, r2) => r1 !== r2});
            switch(data.type) {
                 case "login":
                 currUsers = _this.state.dataSource._dataBlob["s1"];
                 currUsers.push(data.username);
                 _this.setState({ dataSource: ds.cloneWithRows(currUsers) })
                        console.log("New user : "+data.username);
                        break;
                 case "disconnect":
                   currUsers = _this.state.dataSource._dataBlob["s1"];
                   currUsers = _.pull(currUsers, data.username);
                   _this.setState({ dataSource: ds.cloneWithRows(currUsers) })
                   console.log("User disconnected : "+data.username);
                 break;
                default:
                    break;
            }
        })
socket.on('message', function(message){
            var data = message;
            _this.setState({ callResponse: "" })
            switch(data.type) {
                 case "login":
                        onLogin(data);
                        break;
                case "answer":
                      console.log("getting called");
                        onAnswer(data);
                        break;
                case "call_response":
                        onResponse(data);
                      break;
                default:
                    break;
            }
    })

export default class VideoCallingApp extends Component {

  constructor(props) {
     super(props);
     const ds = new ListView.DataSource({rowHasChanged: (r1, r2) => r1 !== r2});
     this.state = {
       currScreen: 'login',
       text : 'userA',
       message : '',
       callResponse : '',
       dataSource: ds.cloneWithRows([]),

       call_screen: false,
       callee_status: null,
       callee_name: "",
       call_status:"off",

       info: 'Initializing',
       status: 'init',
       roomID: '',
       isFront: true,
       selfViewSrc: null,
       remoteList: {},
       textRoomConnected: false,
       textRoomData: [],
       textRoomValue: '',
     }
     // the user of which curren video screen has been rendered
     this.currUser = "";
  }
  componentDidMount(){
    _this = this;


  }
  onPressLogin(){
    let username = this.state.text
    if(username == ""){
      this.setState({ message: "Please enter Username" })
    }else{
      console.log(username);
        socket.send({
              type: "login",
              name: username
                 })
    }
  }
  renderRow(data){
    //let usernameRow = Object.keys(data)[0]
    //console.log("data");
    //console.log(data);
    return(<View style={styles.rowContainer}>
      <TouchableOpacity onPress={() => this.startVideo(data) }><Text style={styles.text} >{ data }</Text></TouchableOpacity>
      </View>)

  }
  backtouserList(){
    this.currUser = "";
    this.setState({ currScreen: 'userList', callResponse : '' })
  }
  startVideo(data){
    //console.warn("Video "+data );
    this.currUser = data;
    this.setState({ currScreen: 'startVideo' })
  }
  callUser(){
    busy = true;
    incallwith = this.currUser
    socket.send({
     type: "call_user",
     name: incallwith,
     callername: username
   })
  }
  renderVideo(){
    return(
      <View style={{ flex:1 }}>
      <StatusBar barStyle="light-content"/>
        <View style={styles.toolbar}>
                        <TouchableOpacity onPress={() => this.backtouserList() }><Text style={styles.toolbarButton}>Back</Text></TouchableOpacity>
                        <Text style={styles.toolbarTitle}>{ this.currUser }</Text>
                        <Text style={styles.toolbarButton}></Text>
        </View>
        <View style={styles.container}>
        {
           this.state.info == 'One peer join!' ?
            (mapHash(this.state.remoteList, function(remote, index) {
               return <RTCView objectFit={"cover"} key={index} streamURL={remote} style={styles.remoteView}/>
             })
           ) : <RTCView objectFit={"cover"} streamURL={this.state.selfViewSrc} style={styles.selfView}/>
         }
            <Button
              onPress={() => this.callUser() }
              title="Call"
              color="#81c04d"
            />
          <Text style={[styles.instructions,{ color: 'grey'}]}>{ this.state.callResponse }</Text>

          </View>
        </View>
    )
  }
  renderLogin(){
    return (
      <View style={{ flex:1 }}>
      <StatusBar barStyle="light-content"/>
        <View style={styles.toolbar}>
                        <Text style={styles.toolbarButton}></Text>
                        <Text style={styles.toolbarTitle}></Text>
                        <Text style={styles.toolbarButton}></Text>
        </View>
      <View style={styles.container}>
          <Text style={styles.instructions}>
            Enter User Name :
          </Text>
          <TextInput
            style={{padding:5, alignSelf: "center", height: 40,width: width*80/100, borderColor: 'gray', borderWidth: 1}}
            onChangeText={(text) => this.setState({text})}
            value={this.state.text}
          />
          <Button
            onPress={() => this.onPressLogin() }
            title="Login"
            color="#81c04d"
          />
        <Text style={styles.instructions}>{ this.state.message }</Text>

        </View>
      </View>
    )
  }
  renderList(){
    return(
      <View style={{ flex:1 }}>
      <StatusBar barStyle="light-content"/>
      <View style={styles.toolbar}>
                      <Text style={styles.toolbarButton}></Text>
                      <Text style={styles.toolbarTitle}></Text>
                      <Text style={styles.toolbarButton}></Text>
      </View>

      <ListView
      //style={{marginTop: 10}}
      enableEmptySections={true}
      dataSource={this.state.dataSource}
      renderRow={ (rowData) => this.renderRow(rowData) }
    />
    </View>)
  }
  render() {
    switch (this.state.currScreen) {
      case 'login':
        return this.renderLogin();
        break;
      case 'userList':
        return this.renderList();
        break;
      case 'startVideo':
      return this.renderVideo();
      break;
      default:

    }
    return this.renderLogin();
  }
}

const styles = StyleSheet.create({
  selfView: {
    width: width,
    height: 450,
  },
  remoteView: {
    width: width,
    height: 450,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
  rowContainer: {
  flex: 1,
  padding: 12,
  flexDirection: 'row',
  alignItems: 'center',
  },
  text: {
    marginLeft: 12,
    fontSize: 16,
  },
  toolbar:{
        backgroundColor:'#81c04d',
        paddingTop:30,
        paddingBottom:10,
        flexDirection:'row'
    },
    toolbarButton:{
        width: 55,
        color:'#fff',
        textAlign:'center'
    },
    toolbarTitle:{
        color:'#fff',
        textAlign:'center',
        fontWeight:'bold',
        flex:1
    }
});

