const express = require('express');
const { KiteConnect } = require('kiteconnect');
const fs = require("fs/promises");
const path = require("path");
const cors = require("cors");


const app = express();
const port = 3000;

const apiKey = '';
const apiSecret = '';

// 1. Initialize KiteConnect Instance
const kc = new KiteConnect({
    api_key: apiKey
});

app.use(express.json());
app.use(cors());

// 2. Redirect the user to Zerodha's Login Page
app.get('/login', (req, res) => {
    const loginUrl = kc.getLoginURL();
    res.redirect(loginUrl);
});



const CONTRACT_FILES = {
    NIFTY: path.join(__dirname, "nifty-contracts.json"),
    SENSEX: path.join(__dirname, "sensex-contracts.json"),
};

async function getTradingSymbol({
    underlying,
    expiry,
    strike,
    type,
}) {
    const filePath = CONTRACT_FILES[underlying];

    if (!filePath) {
        throw new Error(`Unsupported underlying: ${underlying}`);
    }

    const fileContent = await fs.readFile(filePath, "utf8");
    const contractData = JSON.parse(fileContent);

    const instrumentType = type === "CALL" ? "CE" : "PE";

    const instrument = contractData.instruments.find((item) => {
        return (
            item.name === underlying &&
            item.expiry?.slice(0, 10) === expiry &&
            Number(item.strike) === Number(strike) &&
            item.instrument_type === instrumentType
        );
    });

    if (!instrument) {
        throw new Error(
            `Contract not found: ${underlying}, ${expiry}, ${strike}, ${instrumentType}`
        );
    }

    return instrument;
}

// 3. Callback URL to capture the request_token and generate the access_token
app.get('/callback', async (req, res) => {
    const requestToken = req.query.request_token;

    if (!requestToken) {
        return res.status(400).send('Authentication failed: Missing request token.');
    }

    try {
        // Exchange the request token for a persistent access token
        const response = await kc.generateSession(requestToken, apiSecret);

        // Save this access token securely (e.g., in a database, session, or environment variable)
        const accessToken = response.access_token;
        kc.setAccessToken(accessToken);

        console.log("Authenticated successfully! Access Token:", accessToken);
        res.send("Authentication successful! You can now close this window and call APIs.");
    } catch (err) {
        console.error("Token generation error:", err);
        res.status(500).send("Error generating access token.");
    }
});

// 4. Example API Call (Fetch Profile)
app.get('/profile', async (req, res) => {
    try {
        const profile = await kc.getProfile();
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// GET /api/options?symbol=NIFTY&expiry=2026-10-27
app.get("/contracts", async (req, res) => {
    try {
        const symbol = String(req.query.symbol || "NIFTY")
            .trim()
            .toUpperCase();

        const expiry = String(req.query.expiry || "").trim();

        const market = symbol === "NIFTY" ? "NFO" : symbol === "SENSEX" ? "BFO" : null;

        // Validate expiry format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
            return res.status(400).json({
                error: "Provide expiry in YYYY-MM-DD format",
            });
        }

        const parsedDate = new Date(`${expiry}T00:00:00Z`);

        if (
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().slice(0, 10) !== expiry
        ) {
            return res.status(400).json({
                error: "Invalid expiry date",
            });
        }

        // Fetch NSE derivatives instruments using existing Kite instance
        const instruments = await kc.getInstruments(market);

        console.log(instruments);

        const filtered = instruments
            .filter((instrument) => {
                const instrumentExpiry = instrument.expiry
                    ? new Date(instrument.expiry).toISOString().slice(0, 10)
                    : "";

                return (
                    instrument.name === symbol &&
                    instrumentExpiry === expiry &&
                    ["CE", "PE"].includes(instrument.instrument_type)
                );
            })
            .sort(
                (a, b) =>
                    Number(a.strike) - Number(b.strike) ||
                    a.instrument_type.localeCompare(b.instrument_type)
            );

        console.log(filtered);

        return res.json({
            symbol,
            expiry,
            count: filtered.length,
            instruments: filtered,
        });
    } catch (error) {
        console.error("Error fetching option instruments:", error);

        return res.status(500).json({
            error: "Failed to fetch option instruments",
            message: error.message,
        });
    }
});


// Add this route to your existing Express server file

app.post('/place-order', async (req, res) => {

    // Resolve the contract from your local JSON file.
    const instrument = await getTradingSymbol({
        underlying: req.body.underlying,
        expiry: req.body.expiry,
        strike: req.body.strike,
        type: req.body.type,
    });

    try {
        // // Define your order parameters
        // const orderParams = {
        //     exchange: kc.EXCHANGE_NSE,                      // NSE or BSE
        //     tradingsymbol: "NIFTY26O1925200CE",             // Stock trading symbol
        //     transaction_type: kc.TRANSACTION_TYPE_SELL,     // BUY or SELL
        //     quantity: 65,                               // Number of shares
        //     product: kc.PRODUCT_NRML,         // MIS (Intraday) or CNC (Delivery) or NRML (F&O)
        //     order_type: kc.ORDER_TYPE_LIMIT,// MARKET, LIMIT, SL, or SL-M
        //     validity: kc.VALIDITY_DAY,       // DAY or IOC

        //     // Optional parameters based on order_type:
        //     price: 1.00,                // Required only for LIMIT or SL orders
        //     // trigger_price: 448.00         // Required only for SL or SL-M orders
        // };

        // Use the exchange and trading symbol from the matched contract.
        const orderParams = {
            exchange: instrument.exchange,
            tradingsymbol: instrument.tradingsymbol,
            transaction_type:
                req.body.action === "BUY"
                    ? kc.TRANSACTION_TYPE_BUY
                    : kc.TRANSACTION_TYPE_SELL,
            quantity: req.body.quantity,
            product: kc.PRODUCT_NRML,
            order_type: kc.ORDER_TYPE_LIMIT,
            validity: kc.VALIDITY_DAY,
            price: req.body.limitPrice,
        };

        // Punch the order to the exchange
        // 'variety' can be varietyRegular, varietyAmo (After Market Order), or varietyIceberg
        //const orderResponse = await kc.placeOrder(kc.VARIETY_REGULAR, orderParams);

        //console.log("Order placed successfully! Order ID:", orderResponse.order_id);

        res.json({
            success: true,
            message: "Order punched successfully",
            //order_id: orderResponse.order_id
            order: orderParams
        });

    } catch (err) {
        console.error("Failed to place order:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Visit http://localhost:${port}/login to authenticate.`);
});
