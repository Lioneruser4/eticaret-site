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
                <Route path="/" exact component={ProductList}

