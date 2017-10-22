var createClient = ({
  //defaults
  reliable = false,
  ordered = false,
  maxRetransmits = 0,
  signalingServerUrl = 'ws://' + location.hostname + ':8088',
}) => {
  let selfId, otherId, peerConnection, ws, dataChannel;
  const dataChannelConfig = { reliable, ordered, maxRetransmits };
  const sdpConstraints = { offerToReceiveAudio: false, offerToReceiveVideo: false };
  const bus = { //internal pub/sub event bus
    topics: {},
    on(topic, f) {
      this.topics[topic] = this.topics[topic] ? [f, ...this.topics[topic]] : [f];
    },
    emit(topic, payload) {
      if (this.topics[topic]) this.topics[topic].forEach(f => f(payload));
    }
  };
  
  bus.on("dcMessage", e => {
    if(e._topic) {
      Object.defineProperty(e.payload, '_from', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: e._from
      });
      bus.emit(e._topic, e.payload);
    } 
  });
  
  bus.on("wsMessage", e => {
    if(e._topic) bus.emit(e._topic, e.payload);
  });

  //functions
  function connect() {
    return new Promise(res => {
      connectWs().then(res);
    })
  }

  function on(type, cb) {
    bus.on(type, cb);
  }

  function connectWs(id) {
    return new Promise(res => {
      ws = new WebSocket(signalingServerUrl);
      ws.onopen = e => {
        res(e);
        bus.emit("wsOpen", e)
      };
      ws.onclose = e => bus.emit("wsClosed", e);
      ws.onerror = e => bus.emit("wsError", e);
      ws.onmessage = e => {
        const data = JSON.parse(e.data);
        if (data._isSignal) {
          handleSignal(data);
        } else {
          bus.emit("wsMessage", data);
        }
      }
    })
  }

  function connectDc(id) {
    otherId = id;
    connectTo(id);
  }

  function handleSignal(e) {
    switch (e.action) {
      case 'candidate':
        processIce(e.data);
        break;
      case 'offer':
        otherId = e.from;
        processOffer(e.data);
        break;
      case 'answer':
        processAnswer(e.data);
        break;
      case 'clientId':
        selfId = e.id;
        bus.emit("clientId", e.id);
      default:
    }
  }

  function processIce(iceCandidate) {
    peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidate)).catch(e => e)
  }

  function processOffer(offer) {
    const peerConnection = openDataChannel();
    peerConnection.setRemoteDescription(new RTCSessionDescription(offer)).catch(e => e);
    peerConnection.createAnswer(sdpConstraints).then(sdp =>
      peerConnection.setLocalDescription(sdp).then(() => sendNegotiation("answer", sdp)), err => err);
  }

  function processAnswer(answer) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  function sendNegotiation(type, sdp) {
    ws.send(JSON.stringify({
      _isSignal: 1,
      from: selfId,
      to: otherId,
      action: type,
      data: sdp,
    }));
  }

  function connectTo(id) {
    peerConnection = openDataChannel();
    peerConnection.createOffer(sdpConstraints)
      .then(sdp => {
        peerConnection.setLocalDescription(sdp);
        sendNegotiation("offer", sdp);
      }, err => err);
  }

  function openDataChannel() {
    peerConnection = new RTCPeerConnection();
    peerConnection.onicecandidate = e => {
      if (!peerConnection || !e || !e.candidate) return;
      sendNegotiation("candidate", e.candidate);
    }
    peerConnection.ondatachannel = ev => {
      ev.channel.onopen = e => bus.emit("dcOpen", { otherId, selfId });
      ev.channel.onclose = e => bus.emit("dcClosed");
      ev.channel.onmessage = json => bus.emit("dcMessage", JSON.parse(json.data))
    };
    dataChannel = peerConnection.createDataChannel("datachannel", dataChannelConfig);
    return peerConnection;
  }

  function sendDc(e) {
    if (!dataChannel || dataChannel.readyState !== "open") throw new Error("dataChannel not connected.");
    dataChannel.send(JSON.stringify(e));
  }

  function sendWs(e) {
    ws.send(JSON.stringify(e));
  }

  function streamEvent(_topic, payload) {
    const e = { _from: selfId, _topic, payload };
    sendDc(e);
  }

  function emitEvent(_topic, payload, to) {
    const e = { _topic, payload };
    if (to) e.to = to;
    ws.send(JSON.stringify(e));
  }

  return { //public api
    connect,
    connectDc,
    emitEvent,
    sendWs,
    sendDc,
    streamEvent,
    on,
  }
};