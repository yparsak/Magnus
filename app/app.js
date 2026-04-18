
  const express = require('express');
  const os = require('os');
  const path = require('path');
  const app = express();

  const indexRouter   = require('./routes/index');
  const addUserRouter = require('./routes/addUser');
  const userRouter    = require('./routes/user');


  const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    let backupIP = '0.0.0.0';
    // 1. Check for WLAN interfaces first
    for (const name of Object.keys(interfaces)) {
        if (name.startsWith('wlan')) {
            const wlan = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
            if (wlan) return wlan.address;
        }
    }
    // 2. Fallback to Ethernet (eth0, eth1, etc.)
    for (const name of Object.keys(interfaces)) {
        if (name.startsWith('eth')) {
            const eth = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
            if (eth) return eth.address;
        }
    }
    return backupIP; // Defaults to 0.0.0.0 if no specific match is found
  };

  const HOST = getLocalIP();
  const PORT = 3000;

  app.set('view engine', 'ejs');
  app.use(express.static('public'));

  // -- Routes --
  app.use('/', indexRouter);
  app.use('/add_user', addUserRouter);
  app.use('/user', userRouter);

  app.listen(PORT, HOST, () => {
    console.log(`Local Access: http://localhost:${PORT}`);
    console.log(`Network Access: http://${HOST}:${PORT}`);
  });
