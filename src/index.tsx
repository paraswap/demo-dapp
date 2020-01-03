import * as React from 'react';
import * as ReactDOM from 'react-dom';

import {Web3ReactProvider, useWeb3React} from "@web3-react/core";
import {Web3Provider} from "@ethersproject/providers";

import 'semantic-ui-css/semantic.min.css';
import "./stylesheets/style.scss";
import 'c3/c3.css';

import Swapper from "./swapper";

declare let document: any;

function getLibrary(provider: any) {
  return new Web3Provider(provider);
}

const App = () => {
  return (
    <Swapper/>
  )
};

class Root extends React.Component {

  render() {
    return (
      <div className={"root-container"}>
        <Web3ReactProvider getLibrary={getLibrary}>
          <App/>
        </Web3ReactProvider>
      </div>
    )
  }
}

ReactDOM.render(<Root/>, document.getElementById('root'));
