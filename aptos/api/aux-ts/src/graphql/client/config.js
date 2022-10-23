const links = [
    { to: '/', title: "Swap" },
    { to: '/pools', title: "Pools" },
    { to: '/trade', title: "Trade" },
    { to: '/portfolio', title: "Portfolio" }
  ]
window.topnav_links = links 
function getConfig() {
    const host = window.location.host
    window.rest_graphql_endpoint = 'https://aptos-mainnet.atrix.finance/graphql'
    window.ws_graphql_endpoint = 'wss://aptos-mainnet.atrix.finance/graphql'
    if(host.match('devnet')) {
        window.rest_graphql_endpoint = 'https://aptos-mainnet.atrix.finance/graphql'
        window.ws_graphql_endpoint = 'wss://aptos-mainnet.atrix.finance/graphql'
    }
    if(host.match('localhost')) {
        window.rest_graphql_endpoint = 'https://devnet.aux.exchange/graphql'
        window.ws_graphql_endpoint = 'wss://devnet.aux.exchange/graphql'
    }
    if(host.match('testnet')) {
        window.rest_graphql_endpoint = 'https://aptos-mainnet.atrix.finance/graphql'
        window.ws_graphql_endpoint = 'wss://aptos-mainnet.atrix.finance/graphql'
    }
    
}

getConfig()

document.title = "ATRIX"