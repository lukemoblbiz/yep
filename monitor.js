import { Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import bs58 from 'bs58';

// Set up the Solana connection with QuickNode endpoints
const SOLANA_RPC_URL = 'https://virulent-greatest-mountain.solana-mainnet.quiknode.pro/01e6855e8c30948eb8b5b4aac9b70781d123cc04';
const WS_ENDPOINT = 'wss://virulent-greatest-mountain.solana-mainnet.quiknode.pro/01e6855e8c30948eb8b5b4aac9b70781d123cc04';

const connection = new Connection(SOLANA_RPC_URL, {   
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000
});  
  
// Set up the monitored wallet keypair  
const monitoredWalletPrivateKey = 'e39b8d81f49a9ab9d0e093712e638c63631f574d62a970e834e6eb84fa233b088bba0aa9d1cca34fd2ca4bed6604320ea31736f73309ad88aceeb824ce881084';  
const monitoredWalletKeypair = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(monitoredWalletPrivateKey, 'hex')));  
const monitoredWalletPublicKey = monitoredWalletKeypair.publicKey;  
  
// Set up the destination wallet public key  
const destinationWalletPublicKey = new PublicKey('C4ZJ3fxz4anW21kXgbhhNNwR819ctjoaT2YE8SbfTmDG');  
  
// Function to get the SPL token balance of a wallet  
async function getSplTokenBalance(walletPublicKey, tokenMintPublicKey) {  
  const token = new Token(connection, tokenMintPublicKey, TOKEN_PROGRAM_ID, walletPublicKey);  
  const balance = await token.getBalance();  
  return balance;  
}  
  
// Function to send SPL tokens from one wallet to another  
async function sendSplTokens(sourceKeypair, destinationPublicKey, tokenMintPublicKey, amount) {  
  try {
    const sourceATA = getAssociatedTokenAddressSync(
      tokenMintPublicKey,
      sourceKeypair.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const destinationATA = getAssociatedTokenAddressSync(
      tokenMintPublicKey,
      destinationPublicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Quick balance check
    const sourceBalance = await connection.getTokenAccountBalance(sourceATA);
    if (parseInt(sourceBalance.value.amount) === 0) return null;

    const transaction = new Transaction();
    
    // Get fresh blockhash first
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = sourceKeypair.publicKey;

    // First instruction: priority fees
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 100000
      })
    );

    // Check if destination ATA exists, if not create it
    try {
      await connection.getTokenAccountBalance(destinationATA);
    } catch {
      console.log('Creating destination token account...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          sourceKeypair.publicKey,
          destinationATA,
          destinationPublicKey,
          tokenMintPublicKey
        )
      );
    }

    // Last instruction: transfer
    transaction.add(
      createTransferInstruction(
        sourceATA,
        destinationATA,
        sourceKeypair.publicKey,
        amount
      )
    );

    // Sign and serialize
    transaction.sign(sourceKeypair);
    const rawTransaction = transaction.serialize();
    
    // Send multiple times
    const sendPromises = Array(6).fill().map(() => 
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 5,
        preflightCommitment: 'processed'
      })
    );

    try {
      const signatures = await Promise.allSettled(sendPromises);
      const validSignature = signatures.find(r => r.status === 'fulfilled')?.value;
      
      if (validSignature) {
        console.log(`Sent tx: ${validSignature.slice(0, 8)}... | Solscan: https://solscan.io/tx/${validSignature}`);
        return validSignature;
      }
    } catch (error) {
      // Silently handle transaction errors
      return null;
    }

    return null;

  } catch (error) {
    // Only log non-transaction related errors, and keep running
    if (!error.toString().includes('transaction fees') && 
        !error.toString().includes('getTokenAccountBalance') &&
        !error.toString().includes('simulation failed')) {
      console.log('Wallet temporarily unavailable - continuing to monitor...');
    }
    return null;
  }
}  
  
// Add a lock flag at the top of the file
let isProcessing = false;

// Add this helper function for better console output
function consoleLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

async function checkAndSendSplTokens(sourceKeypair, destinationPublicKey) {
  try {
    consoleLog(`Checking wallet: ${sourceKeypair.publicKey.toString()}`);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      sourceKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    consoleLog(`Found ${tokenAccounts.value.length} total token accounts`);
    const nonZeroAccounts = tokenAccounts.value.filter(
      account => account.account.data.parsed.info.tokenAmount.uiAmount > 0
    );
    consoleLog(`Processing ${nonZeroAccounts.length} accounts with non-zero balances`);

    for (const tokenAccount of nonZeroAccounts) {
      try {
        const mintAddress = tokenAccount.account.data.parsed.info.mint;
        const balance = parseInt(tokenAccount.account.data.parsed.info.tokenAmount.amount);
        
        consoleLog(`Found token: ${mintAddress} with balance: ${balance}`);
        
        const result = await sendSplTokens(
          sourceKeypair,
          destinationPublicKey,
          new PublicKey(mintAddress),
          balance
        );

        if (result) {
          consoleLog(`Successfully processed token ${mintAddress}`, 'success');
          consoleLog(`Solscan: https://solscan.io/tx/${result}`, 'success');
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        consoleLog(`Error processing token: ${error}`, 'error');
        continue;
      }
    }
  } catch (error) {
    consoleLog(`Error in checkAndSendSplTokens: ${error}`, 'error');
  }
}

// Main loop
async function main() {
  consoleLog('Starting token monitor...');
  
  while (true) {
    try {
      await checkAndSendSplTokens(monitoredWalletKeypair, destinationWalletPublicKey);
    } catch (error) {
      consoleLog(`Error in main loop: ${error}`, 'error');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Run with PM2 to keep it alive
consoleLog('Initializing monitor...');
main().catch(error => consoleLog(`Fatal error: ${error}`, 'error'));
