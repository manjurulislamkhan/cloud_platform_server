import { Request, Response } from "express";
import express from "express";
import Stripe from "stripe";


const router = express.Router();

// This is your test secret API key. 

const stripe = new Stripe('sk_test_51KZTvnDkLQlSWhi2d9rUIjG1p5EKjIHl4KYcaOIOcbWKfJIFjDbEfTX86tasktFGM4zM0TrIfJdfWssggZkmaMQY004Kyzs5h6', {
  apiVersion: '2025-03-31.basil' as any,
});
// For regular payments by customers


// router.post('/create-checkout-session', async (req: Request, res: Response) => {
//   const session = await stripe.checkout.sessions.create({
//     line_items: [
//       {
//         price_data: {
//           currency: 'aud',
//           product_data: {
//             name: 'T-shirt',
//           },
//           unit_amount: 2000,
//         },
//         quantity: 1,
//       },
//     ],
//     mode: 'payment',
//     ui_mode: 'custom',
//     // The URL of your payment completion page
//     return_url: 'https://manjurulislamkhan.com/return?session_id={CHECKOUT_SESSION_ID}'
//   });

//   res.json({checkoutSessionClientSecret: session.client_secret});
// });

router.post('/create-checkout-session', async (req: Request, res: Response) => {
  
const paymentIntent = await stripe.paymentIntents.create({
  amount: 2000,
  currency: 'aud',
});
res.json({ clientSecret: paymentIntent.client_secret });

});




//  For Connect Accounts

let newConnectAccId:string = "";

router.post("/account", async (req, res) => {
  try {
    const account = await stripe.accounts.create({type:"express"});

    if (account.id) {
      newConnectAccId = account.id
      
    }
    res.json({
      account: account.id,
    });
  } catch (error:any) {
    console.error(
      "An error occurred when calling the Stripe API to create an account",
      error
    );
    res.status(500);
    res.send({ error: error.message });
  }
});


router.post("/account-link", async (req, res) => {
  try {
    const accountLink = await stripe.accountLinks.create({
      account: newConnectAccId,
      refresh_url: "https://manjurulislamkhan.com/reauth",
      return_url: "https://manjurulislamkhan.com/return",
      type: "account_onboarding",
    });

    res.json({
      url: accountLink.url,
    });
  } catch (error:any) {
    console.error(
      "An error occurred when calling the Stripe API to create an account link",
      error
    );
    res.status(500);
    res.send({ error: error.message });
  }
});


export default router