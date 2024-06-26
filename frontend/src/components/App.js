import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import ProductList from './ProductList';
import ProductForm from './ProductForm';

const App = () => (
    <Router>
        <div className="container">
            <Switch>
                <Route path="/" exact component={ProductList} />
                <Route path="/login" component={Login} />
                <Route path="/register" component={Register} />
                <Route path="/add-product" component={ProductForm} />
                <Route path="/edit-product/:id" component={ProductForm} />
            </Switch>
        </div>
    </Router>
);

export default App;
