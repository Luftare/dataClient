const WebSocket = require("ws");
const WebSocketServer = require('ws').Server;
const wss = new WebSocketServer({port: 8088});
const express = require('express');
const app = express();

let clients = [];
let idCounter = 1;

wss.on('connection', ws => {
	const id = idCounter++;
	clients.push({
		socket: ws,
		id,
	});
 
	ws.send(JSON.stringify({
		action: 'clientId',
		_isSignal: 1,
		id
	}));
	
	updateClients();

	ws.on('close', () => {
		clients = clients.filter(c => c.id !== id);
		updateClients();
	});

	ws.on('message', json => {
		const data = JSON.parse(json);
		if(data.to) {
			const client = clients.find(c => c.id === data.to);
			if(client) client.socket.send(json);
		} else {
			clients.forEach(c => c.socket.send(json));	
		}
	});
});

app.use(express.static(__dirname + '/client'));
app.listen(8888);

function updateClients() {
	const list = clients.map(c => {
		return {
			id: c.id,
		}
	});
	const data = {
		_topic: "clientsUpdate",
		payload: list,
	}
	const json = JSON.stringify(data);
	clients.forEach(c => c.socket.send(json));
}